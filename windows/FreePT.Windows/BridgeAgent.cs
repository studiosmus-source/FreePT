using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
namespace FreePT.Windows;
public sealed class BridgeAgent: IAsyncDisposable {
    private static readonly Uri Endpoint=new("https://freept-bridge-staging.onrender.com/");
    private readonly HttpClient http=new(new HttpClientHandler{AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(36)};
    private readonly BridgeConfig config;
    private readonly BridgeCatalogue catalogue;
    private CancellationTokenSource? stop;
    private Task? worker;
    public event Action<string>? State;
    public bool IsRunning=>worker!=null&&!worker.IsCompleted;
    public BridgeAgent(BridgeConfig value) {
        config=value;catalogue=new BridgeCatalogue();
    }
    public void Start(){
        if(IsRunning)return;
        stop=new CancellationTokenSource();
        worker=Task.Run(()=>Work(stop.Token));
    }
    public async Task Stop(){
        stop?.Cancel();
        if(worker!=null)try{await worker;}catch(OperationCanceledException){}
        State?.Invoke("Bridge fermo");
    }
    private void Status(string status)=>State?.Invoke(status);
    private async Task<JsonDocument> Post(string route,object value,CancellationToken ct){
        using var response=await http.PostAsJsonAsync(new Uri(Endpoint,route),value,ct);
        if(response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized)
            throw new UnauthorizedAccessException("Autorizzazione Bridge non valida o revocata");
        response.EnsureSuccessStatusCode();
        using var stream=await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream,new JsonDocumentOptions{MaxDepth=16},ct);
    }
    private static string GetString(JsonElement node,string field)=>node.GetProperty(field).GetString()??throw new JsonException();
    private static object Auth(string id,string token)=>new {deviceId=id,sessionToken=token};
    private async Task Work(CancellationToken ct){
        int delay=1500;
        while(!ct.IsCancellationRequested){
            bool connectedOnce=false;
            try{
                Status("Collegamento al server…");
                using var connect=await Post("bridge/tx/connect",new{
                    deviceId=config.DeviceId,deviceSecret=config.DeviceSecret},ct);
                string session=GetString(connect.RootElement,"token");
                if(!System.Text.RegularExpressions.Regex.IsMatch(session,"^[a-f0-9]{64}$"))
                    throw new JsonException("Invalid session");
                connectedOnce=true;delay=1500;Status("Bridge attivo e collegato");
                int follow=0;
                while(!ct.IsCancellationRequested){
                    using var poll=await Post("bridge/tx/poll",Auth(config.DeviceId,session),ct);
                    if(poll.RootElement.TryGetProperty("job",out var job)&&job.ValueKind==JsonValueKind.Object){
                        await Execute(job,session,ct);
                        follow=2;Status("Bridge attivo e collegato");
                    }else{
                        await Task.Delay(follow>0?750:2000,ct);
                        if(follow>0)follow--;
                    }
                }
            }catch(OperationCanceledException)when(ct.IsCancellationRequested){break;}
            catch(UnauthorizedAccessException){
                if(!connectedOnce){
                    Status("Accesso revocato o associazione non valida. Bridge fermato.");
                    break;
                }
                Status("Sessione scaduta, riconnessione…");
                await Task.Delay(1000,ct);
            }catch(Exception e)when(e is HttpRequestException or TaskCanceledException or JsonException or IOException){
                Status("Connessione momentaneamente non disponibile");
                await Task.Delay(delay,ct);
                delay=Math.Min(delay*2,8000);
            }catch(Exception){
                // Never send local file paths or credential details to logs or the server.
                Status("Operazione non disponibile; nuovo tentativo");
                await Task.Delay(delay,ct);
                delay=Math.Min(delay*2,8000);
            }
        }
    }
    private async Task Execute(JsonElement job,string token,CancellationToken ct){
        string id=GetString(job,"deviceId");
        string jobId=GetString(job,"jobId");
        if(id!=config.DeviceId||!Guid.TryParse(jobId,out _))throw new UnauthorizedAccessException();
        string op=GetString(job,"operation");
        string handle=job.TryGetProperty("handle",out var h)?h.GetString()??"root":"root";
        JsonDocument ack;
        switch(op){
            case "list":{
                var page=catalogue.Browse("root",0);
                if(page.NextOffset!=-1)throw new IOException("Root catalogue too large");
                ack=await Post("bridge/tx/folder",new{deviceId=id,sessionToken=token,jobId,entries=page.Entries},ct);
                break;
            }
            case "browse":{
                int offset=job.GetProperty("offset").GetInt32();
                var page=catalogue.Browse(handle,offset);
                ack=await Post("bridge/tx/browse",new{deviceId=id,sessionToken=token,jobId,entries=page.Entries,nextOffset=page.NextOffset},ct);
                break;
            }
            case "read":{
                long offset=job.GetProperty("offset").GetInt64();
                int length=job.GetProperty("length").GetInt32();
                var chunk=catalogue.Read(handle,offset,length);
                ack=await Post("bridge/tx/chunk",new{deviceId=id,sessionToken=token,jobId,chunk},ct);
                break;
            }
            default:throw new JsonException("Unsupported operation");
        }
        using(ack){
            var response=ack.RootElement;
            if(GetString(response,"jobId")!=jobId||
               GetString(response,"deviceId")!=id||
               GetString(response,"state")!="done")throw new JsonException("Unexpected acknowledgement");
        }
    }
    public async ValueTask DisposeAsync(){await Stop();http.Dispose();stop?.Dispose();}
}

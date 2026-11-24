using System.Net.Http.Json;
using System.Text.Json;
namespace FreePT.Windows;
internal sealed class EnrollmentClient:IDisposable {
    private const string Supabase="https://aqjuixbuxftnjfzxmzuj.supabase.co/";
    private const string Bridge="https://freept-bridge-staging.onrender.com/";
    private readonly HttpClient client=new(new HttpClientHandler{AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(25)};
    private readonly string key;
    internal EnrollmentClient(string publishableKey){
        if(!publishableKey.StartsWith("sb_publishable_",StringComparison.Ordinal) || publishableKey.Length<30)
            throw new InvalidOperationException("Configurazione Supabase TEST mancante");
        key=publishableKey;
    }
    private async Task<JsonDocument> Send(string url,object input,string? jwt=null){
        using var request=new HttpRequestMessage(HttpMethod.Post,url){
            Content=JsonContent.Create(input)};
        request.Headers.TryAddWithoutValidation("apikey",key);
        if(jwt!=null)request.Headers.TryAddWithoutValidation("authorization","Bearer "+jwt);
        using var response=await client.SendAsync(request);
        if(!response.IsSuccessStatusCode)throw new InvalidOperationException(
            response.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
            ?"Account non autorizzato":"Richiesta non completata");
        return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
    }
    internal async Task<BridgeConfig> Enroll(string email,string password,string[] roots){
        if(string.IsNullOrWhiteSpace(email)||string.IsNullOrWhiteSpace(password))
            throw new ArgumentException("Inserisci email e password FreePT");
        using var login=await Send(Supabase+"auth/v1/token?grant_type=password",new{email,password});
        string jwt=login.RootElement.GetProperty("access_token").GetString()??throw new JsonException();
        // Check approved user role server-side before creating a device.
        using var response=await Send(Bridge+"bridge/owner/enroll",new{label="PC Windows FreePT"},jwt);
        string deviceId=response.RootElement.GetProperty("deviceId").GetString()??throw new JsonException();
        string deviceSecret=response.RootElement.GetProperty("deviceSecret").GetString()??throw new JsonException();
        if(!Guid.TryParse(deviceId,out _)||
           !System.Text.RegularExpressions.Regex.IsMatch(deviceSecret,"^[a-f0-9]{64}$"))
            throw new JsonException("Credenziali del Bridge non valide");
        var config=new BridgeConfig(deviceId,deviceSecret,roots);
        LocalState.Write(config);
        // Family activation is owner initiated; if it fails, keep the device
        // for an explicit retry rather than silently removing its credentials.
        try{
            using var activate=await Send(Supabase+"rest/v1/rpc/bridge_owner_activate_family",
                new{p_device_id=deviceId},jwt);
        }catch{ /* Owner may enable or grant access later; no hidden auto retries. */ }
        return config;
    }
    public void Dispose()=>client.Dispose();
}

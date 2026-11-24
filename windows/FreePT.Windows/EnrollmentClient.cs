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
    internal async Task<BridgeConfig> Enroll(string accessToken,string[] roots){
        if(string.IsNullOrWhiteSpace(accessToken)||accessToken.Length<20)
            throw new ArgumentException("Accedi alla chat FreePT come utente approvato");
        // Existing owner endpoint checks this exact Supabase session, including
        // approved profile and ownership. No password or new identity is created.
        using var response=await Send(Bridge+"bridge/owner/enroll",new{label="PC Windows FreePT"},accessToken);
        string deviceId=response.RootElement.GetProperty("deviceId").GetString()??throw new JsonException();
        string deviceSecret=response.RootElement.GetProperty("deviceSecret").GetString()??throw new JsonException();
        if(!Guid.TryParse(deviceId,out _)||
           !System.Text.RegularExpressions.Regex.IsMatch(deviceSecret,"^[a-f0-9]{64}$"))
            throw new JsonException("Credenziali del Bridge non valide");
        var config=new BridgeConfig(deviceId,deviceSecret,roots);
        LocalState.Write(config);
        // Owner explicitly pressed activation; only an authorized profile can
        // activate its own device. Failed activation leaves the account intact.
        try{
            using var activate=await Send(Supabase+"rest/v1/rpc/bridge_owner_activate_family",
                new{p_device_id=deviceId},accessToken);
        }catch{/* Server grants remain authoritative; activation may be retried from owner controls. */}
        return config;
    }
    public void Dispose()=>client.Dispose();
}

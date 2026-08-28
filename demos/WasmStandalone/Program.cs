using BlazorDeveloperTools;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using WasmStandalone;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

// Blazor Developer Tools - same one-liner as on Blazor Server
builder.Services.AddBlazorDevTools(options =>
{
    options.EnableEventPush = true;
});

await builder.Build().RunAsync();

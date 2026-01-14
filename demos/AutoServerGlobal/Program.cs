using AutoServerGlobal.Components;
using BlazorDeveloperTools;
using BlazorDeveloperTools.Diagnostics;


var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents(options =>
    {
        options.DetailedErrors = true;
    });

builder.Services.AddBlazorDevTools();

WebApplication app = builder.Build();

RendererDiagnostics.DumpRendererInfo();
Console.WriteLine("\n[Testing RendererInterop initialization...]");
Console.WriteLine($"RendererInterop.IsSupported: {BlazorDeveloperTools.RendererInterop.IsSupported}");

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();

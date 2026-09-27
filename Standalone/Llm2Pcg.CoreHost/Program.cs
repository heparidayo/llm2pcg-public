using System.Text.Json;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;

if (args.Contains("--v4-batch", StringComparer.Ordinal))
{
    Environment.ExitCode = V4Endpoints.RunBatch();
    return;
}

if (args.Contains("--self-test", StringComparer.Ordinal))
{
    Environment.ExitCode = CoreHostSelfTest.Run();
    return;
}

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(Environment.GetEnvironmentVariable("LLM2PCG_CORE_URL") ?? "http://127.0.0.1:8090");
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins("http://127.0.0.1:3000", "http://localhost:3000")
    .AllowAnyHeader()
    .AllowAnyMethod()));
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.IncludeFields = true;
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
});

WebApplication app = builder.Build();
app.UseCors();
V4Endpoints.Map(app);

app.MapGet("/health", () => Results.Ok(new
{
    ok = true,
    service = "llm2pcg-core-host",
    generatedWorldFormatVersion = 1,
    unityRequired = false
}));

app.MapPost("/api/world/generate", (PCGRequest request) =>
{
    try
    {
        PCGValidationResult validation = PCGRequestValidator.Validate(request);
        if (!validation.IsValid)
            return Results.Json(new { ok = false, code = validation.Code, message = validation.Message }, statusCode: StatusCodes.Status400BadRequest);

        IPCGWorldData world = PCGGeneratorRegistry.Default.GetRequired(request).Generate(request);
        GeneratedWorldDocument document = GeneratedWorldDocumentFactory.Create(world, request);
        return Results.Ok(new { ok = true, world = document });
    }
    catch (ArgumentException exception)
    {
        return Results.Json(new { ok = false, code = "INVALID_PCG_REQUEST", message = exception.Message }, statusCode: StatusCodes.Status400BadRequest);
    }
    catch (Exception exception)
    {
        return Results.Json(new { ok = false, code = "CORE_GENERATION_FAILED", message = exception.Message }, statusCode: StatusCodes.Status500InternalServerError);
    }
});

app.MapGet("/", () => Results.Ok(new
{
    name = "LLM2PCG Standalone CoreHost",
    endpoint = "POST /api/world/generate",
    health = "GET /health"
}));

app.Run();

internal static class CoreHostSelfTest
{
    private static readonly (string WorldType, string ExpectedHash)[] GoldenCases =
    {
        (PCGRequest.DungeonWorldType, "7BFB4589"),
        (PCGRequest.CaveWorldType, "A2EF3948"),
        (PCGRequest.ForestWorldType, "2418314A"),
        (PCGRequest.CityWorldType, "34B02A50")
    };

    public static int Run()
    {
        try
        {
            foreach ((string worldType, string expectedHash) in GoldenCases)
            {
                PCGRequest request = DefaultRequest(worldType, 24680, 128, 128);
                IPCGWorldData generated = PCGGeneratorRegistry.Default.GetRequired(request).Generate(request);
                Require(generated.ComputeStableHash() == expectedHash, worldType + " golden hash changed.");
                GeneratedWorldDocument document = GeneratedWorldDocumentFactory.Create(generated);
                Require(document.WorldHash == expectedHash, worldType + " document hash mismatch.");
                Require(Convert.FromBase64String(document.Cells).Length == 128 * 128, worldType + " grid length mismatch.");
                Console.WriteLine("PASS " + worldType + " hash=" + expectedHash);
            }

            foreach (string worldType in new[] { PCGRequest.SwampWorldType, PCGRequest.SnowfieldWorldType, PCGRequest.DesertWorldType })
            {
                PCGRequest firstRequest = DefaultRequest(worldType, 24680, 128, 128);
                PCGRequest secondRequest = DefaultRequest(worldType, 24680, 128, 128);
                IPCGWorldData first = PCGGeneratorRegistry.Default.GetRequired(firstRequest).Generate(firstRequest);
                IPCGWorldData second = PCGGeneratorRegistry.Default.GetRequired(secondRequest).Generate(secondRequest);
                Require(first.ComputeStableHash() == second.ComputeStableHash(), worldType + " is not deterministic.");
                GeneratedWorldDocument document = GeneratedWorldDocumentFactory.Create(first);
                Require(Convert.FromBase64String(document.Cells).Length == 128 * 128, worldType + " grid length mismatch.");
                Console.WriteLine("PASS " + worldType + " deterministic hash=" + first.ComputeStableHash());
            }

            Llm2Pcg.Tests.PcgCoreRegressionChecks.Run();
            V4Endpoints.SelfTest();
            Console.WriteLine("Standalone CoreHost self-test: 7 world baselines and 9 Core regression groups passed.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("FAIL " + exception.Message);
            return 1;
        }
    }

    private static PCGRequest DefaultRequest(string worldType, int seed, int width, int height)
    {
        if (worldType == PCGRequest.DungeonWorldType) return PCGRequest.CreateDefault(seed, width, height);
        if (worldType == PCGRequest.CaveWorldType) return PCGRequest.CreateCaveDefault(seed, width, height);
        if (worldType == PCGRequest.ForestWorldType) return PCGRequest.CreateForestDefault(seed, width, height);
        if (worldType == PCGRequest.CityWorldType) return PCGRequest.CreateCityDefault(seed, width, height);
        if (worldType == PCGRequest.SwampWorldType) return PCGRequest.CreateSwampDefault(seed, width, height);
        if (worldType == PCGRequest.SnowfieldWorldType) return PCGRequest.CreateSnowfieldDefault(seed, width, height);
        if (worldType == PCGRequest.DesertWorldType) return PCGRequest.CreateDesertDefault(seed, width, height);
        throw new ArgumentOutOfRangeException(nameof(worldType), worldType, "Unsupported world type.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}

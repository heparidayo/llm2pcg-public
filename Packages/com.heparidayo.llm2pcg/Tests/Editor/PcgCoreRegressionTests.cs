using NUnit.Framework;

namespace Llm2Pcg.Tests.EditMode
{
    public sealed class PcgCoreRegressionTests
    {
        [Test] public void NoiseRounding() => PcgCoreRegressionChecks.NoiseRounding();
        [Test] public void SpacingMatchesBruteForce() => PcgCoreRegressionChecks.SpacingMatchesBruteForce();
        [Test] public void NumericGuards() => PcgCoreRegressionChecks.NumericGuards();
        [Test] public void MapGuards() => PcgCoreRegressionChecks.MapGuards();
        [Test] public void LegacyDefaults() => PcgCoreRegressionChecks.LegacyDefaults();
        [Test] public void DungeonOutcomeDiagnostics() => PcgCoreRegressionChecks.DungeonOutcomeDiagnostics();
        [Test] public void NavigableEndpoints() => PcgCoreRegressionChecks.NavigableEndpoints();
        [Test] public void TerrainLandforms() => PcgCoreRegressionChecks.TerrainLandforms();
        [Test] public void RiverLayouts() => PcgCoreRegressionChecks.RiverLayouts();
    }
}

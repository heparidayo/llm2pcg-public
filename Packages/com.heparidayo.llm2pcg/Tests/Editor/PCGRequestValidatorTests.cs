using Llm2Pcg.Contract;
using Llm2Pcg.Generators.Dungeon;
using NUnit.Framework;

namespace Llm2Pcg.Tests.EditMode
{
    public sealed class PCGRequestValidatorTests
    {
        [Test]
        public void DefaultRequest_IsValid()
        {
            PCGValidationResult result = PCGRequestValidator.Validate(PCGRequest.CreateDefault());

            Assert.That(result.IsValid, Is.True, result.Message);
        }

        [Test]
        public void VisualSettings_OmittedLegacyV2RequestNormalizesToUnrestrictedDefaults()
        {
            PCGRequest request = PCGRequest.CreateForestDefault();
            request.schemaVersion = 2;
            request.visualSettings = null;
            request.presentationSettings = null;
            request.layoutSettings = null;

            PCGValidationResult result = PCGRequestValidator.Validate(request);

            Assert.That(result.IsValid, Is.True, result.Message);
            Assert.That(request.schemaVersion, Is.EqualTo(3));
            Assert.That(request.visualSettings.trees.density, Is.EqualTo(1f));
            Assert.That(request.visualSettings.trees.allowedTypes, Is.Empty);
            Assert.That(request.presentationSettings.geometryMode, Is.EqualTo(PresentationGeometryModes.Surface));
            Assert.That(request.presentationSettings.propsEnabled, Is.True);
            Assert.That(request.layoutSettings.landform.kind, Is.EqualTo(SpatialLayoutValues.None));
            Assert.That(request.layoutSettings.water.kind, Is.EqualTo(SpatialLayoutValues.Default));
            Assert.That(request.layoutSettings.route.kind, Is.EqualTo(SpatialLayoutValues.Default));
        }

        [Test]
        public void PresentationSettings_SupportAllEvolutionCombinationsAndRejectUnknownGeometry()
        {
            foreach (string geometryMode in new[] { PresentationGeometryModes.Voxel, PresentationGeometryModes.Surface })
            foreach (bool propsEnabled in new[] { false, true })
            {
                PCGRequest request = PCGRequest.CreateForestDefault(99120);
                request.presentationSettings = new PresentationSettings { geometryMode = geometryMode, propsEnabled = propsEnabled };
                Assert.That(PCGRequestValidator.Validate(request).IsValid, Is.True);
            }

            PCGRequest invalid = PCGRequest.CreateForestDefault(99120);
            invalid.presentationSettings.geometryMode = "Smoothish";
            Assert.That(PCGRequestValidator.Validate(invalid).Code, Is.EqualTo("INVALID_PRESENTATION_SETTINGS"));
        }

        [Test]
        public void VisualSettings_RejectUnknownTypeAndOutOfRangeDensity()
        {
            PCGRequest request = PCGRequest.CreateForestDefault();
            request.visualSettings.trees.allowedTypes = new[] { "imaginary_tree" };
            Assert.That(PCGRequestValidator.Validate(request).Code, Is.EqualTo("INVALID_VISUAL_SETTINGS"));

            request = PCGRequest.CreateForestDefault();
            request.visualSettings.trees.density = 1.1f;
            Assert.That(PCGRequestValidator.Validate(request).Code, Is.EqualTo("INVALID_VISUAL_SETTINGS"));
        }

        [Test]
        public void UnsupportedWorldType_ReturnsExplicitError()
        {
            PCGRequest request = PCGRequest.CreateDefault();
            request.worldType = "Cave";

            PCGValidationResult result = PCGRequestValidator.Validate(request);

            Assert.That(result.Code, Is.EqualTo("UNSUPPORTED_WORLD_TYPE"));
        }

        [Test]
        public void LeafSizeMatchingMapDimension_IsRejected()
        {
            PCGRequest request = PCGRequest.CreateDefault(mapWidth: 100, mapHeight: 100);
            request.generatorSettings.dungeon.minLeafSize = 100;

            PCGValidationResult result = PCGRequestValidator.Validate(request);

            Assert.That(result.Code, Is.EqualTo("INVALID_MIN_LEAF_SIZE"));
        }

        [Test]
        public void LegacyV1Dungeon_UpgradesWithoutChangingGeneratedHash()
        {
            PCGRequest v2 = PCGRequest.CreateDefault(seed: 99117);
            string expected = new DungeonBSPGenerator().Generate(v2).ComputeStableHash();
            PCGRequest legacy = PCGRequest.CreateDefault(seed: 99117);
            legacy.schemaVersion = 1;
            legacy.generatorVersion = null;

            PCGValidationResult result = PCGRequestValidator.Validate(legacy);

            Assert.That(result.IsValid, Is.True, result.Message);
            Assert.That(legacy.schemaVersion, Is.EqualTo(3));
            Assert.That(legacy.generatorVersion, Is.EqualTo(PCGRequest.DungeonGeneratorVersion));
            Assert.That(new DungeonBSPGenerator().Generate(legacy).ComputeStableHash(), Is.EqualTo(expected));
        }

        [Test]
        public void MultipleGeneratorBranches_AreRejected()
        {
            PCGRequest request = PCGRequest.CreateDefault();
            request.generatorSettings.cave = new CaveGeneratorSettings { fillPercent = 46, automataSteps = 5, minimumRegionSize = 24, tunnelRadius = 1 };

            Assert.That(PCGRequestValidator.Validate(request).Code, Is.EqualTo("INVALID_GENERATOR_SETTINGS"));
        }

        [TestCase("Swamp")]
        [TestCase("Snowfield")]
        [TestCase("Desert")]
        public void NatureDefaults_ReuseExactlyForestSettingsBranch(string worldType)
        {
            PCGRequest request = worldType == PCGRequest.SwampWorldType ? PCGRequest.CreateSwampDefault() : worldType == PCGRequest.SnowfieldWorldType ? PCGRequest.CreateSnowfieldDefault() : PCGRequest.CreateDesertDefault();

            PCGValidationResult result = PCGRequestValidator.Validate(request);

            Assert.That(result.IsValid, Is.True, result.Message);
            Assert.That(request.generatorSettings.forest, Is.Not.Null);
            Assert.That(request.generatorSettings.dungeon, Is.Null);
            Assert.That(request.generatorSettings.city, Is.Null);
            Assert.That(request.generatorSettings.cave, Is.Null);
        }

        [Test]
        public void NatureRequest_WithMismatchedBiomeOrSettingsBranch_IsRejected()
        {
            PCGRequest request = PCGRequest.CreateSwampDefault();
            request.biome = PCGRequest.AridBiome;
            Assert.That(PCGRequestValidator.Validate(request).Code, Is.EqualTo("INVALID_GENERATOR_SETTINGS"));

            request = PCGRequest.CreateSnowfieldDefault();
            request.generatorSettings.city = PCGRequest.CreateCityDefault().generatorSettings.city;
            Assert.That(PCGRequestValidator.Validate(request).Code, Is.EqualTo("INVALID_GENERATOR_SETTINGS"));
        }

        [Test]
        public void WaterAndRouteOverrides_AndDungeonMountains_AreRejected()
        {
            PCGRequest forest = PCGRequest.CreateForestDefault();
            forest.layoutSettings.landform = new LandformLayoutSettings { kind = SpatialLayoutValues.Mountain, placement = SpatialLayoutValues.Center, size = SpatialLayoutValues.Large, intensity = SpatialLayoutValues.High };
            forest.layoutSettings.water = new WaterLayoutSettings { kind = SpatialLayoutValues.River, placement = SpatialLayoutValues.CenterCrossing, size = SpatialLayoutValues.Large, meander = SpatialLayoutValues.Medium, exclusive = false };
            Assert.That(PCGRequestValidator.Validate(forest).Code, Is.EqualTo("UNSUPPORTED_LAYOUT_SETTINGS"));

            PCGRequest city = PCGRequest.CreateCityDefault();
            city.layoutSettings.route = new RouteLayoutSettings { kind = SpatialLayoutValues.Road, placement = SpatialLayoutValues.CenterCrossing, size = SpatialLayoutValues.Large, orientation = SpatialLayoutValues.Seeded, meander = SpatialLayoutValues.Low };
            Assert.That(PCGRequestValidator.Validate(city).Code, Is.EqualTo("UNSUPPORTED_LAYOUT_SETTINGS"));

            PCGRequest dungeon = PCGRequest.CreateDefault();
            dungeon.layoutSettings.landform.kind = SpatialLayoutValues.Mountain;
            Assert.That(PCGRequestValidator.Validate(dungeon).Code, Is.EqualTo("UNSUPPORTED_LAYOUT_SETTINGS"));
        }
    }
}

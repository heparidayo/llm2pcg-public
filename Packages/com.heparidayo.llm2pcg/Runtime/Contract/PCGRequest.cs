using System;

namespace Llm2Pcg.Contract
{
    /// <summary>Versioned request shared by Unity, Web and MCP. Public fields are required by JsonUtility.</summary>
    [Serializable]
    public sealed class PCGRequest
    {
        public const int CurrentSchemaVersion = 3;
        public const string DungeonWorldType = "Dungeon";
        public const string CityWorldType = "City";
        public const string ForestWorldType = "Forest";
        public const string CaveWorldType = "Cave";
        public const string SwampWorldType = "Swamp";
        public const string SnowfieldWorldType = "Snowfield";
        public const string DesertWorldType = "Desert";
        public const string StoneBiome = "Stone";
        public const string TemperateBiome = "Temperate";
        public const string WetlandBiome = "Wetland";
        public const string ArcticBiome = "Arctic";
        public const string AridBiome = "Arid";
        public const string DungeonGeneratorVersion = "dungeon-bsp@1";
        public const string CityGeneratorVersion = "city-hybrid-wfc@1";
        public const string ForestGeneratorVersion = "forest-biome@1";
        public const string CaveGeneratorVersion = "cave-cellular@1";
        public const string SwampGeneratorVersion = "swamp-biome@1";
        public const string SnowfieldGeneratorVersion = "snowfield-biome@1";
        public const string DesertGeneratorVersion = "desert-biome@1";
        public const string DefaultDungeonProfile = "DefaultDungeon";
        public const string CompactDungeonProfile = "CompactDungeon";
        public const string SprawlingDungeonProfile = "SprawlingDungeon";
        public const string DefaultCityProfile = "DefaultCity";
        public const string GridCityProfile = "GridCity";
        public const string OrganicCityProfile = "OrganicCity";
        public const string DefaultForestProfile = "DefaultForest";
        public const string DenseForestProfile = "DenseForest";
        public const string MeadowForestProfile = "MeadowForest";
        public const string DefaultCaveProfile = "DefaultCave";
        public const string CavernousCaveProfile = "CavernousCave";
        public const string TightCaveProfile = "TightCave";
        public const string DefaultSwampProfile = "DefaultSwamp";
        public const string OpenMarshProfile = "OpenMarsh";
        public const string DenseBogProfile = "DenseBog";
        public const string DefaultSnowfieldProfile = "DefaultSnowfield";
        public const string SparseTundraProfile = "SparseTundra";
        public const string FrozenGroveProfile = "FrozenGrove";
        public const string DefaultDesertProfile = "DefaultDesert";
        public const string DuneSeaProfile = "DuneSea";
        public const string OasisDesertProfile = "OasisDesert";

        public int schemaVersion;
        public string generatorVersion;
        public int seed;
        public string worldType;
        public string biome;
        public string generationProfile;
        public int mapWidth;
        public int mapHeight;
        public GeneratorSettings generatorSettings;
        public PropSettings propSettings;
        public VisualSettings visualSettings;
        public PresentationSettings presentationSettings;
        public LayoutSettings layoutSettings;
        public SpecialRoomsSettings specialRooms;

        public static PCGRequest CreateDefault(int seed = 12345, int mapWidth = 100, int mapHeight = 100)
        {
            return new PCGRequest
            {
                schemaVersion = CurrentSchemaVersion, generatorVersion = DungeonGeneratorVersion, seed = seed,
                worldType = DungeonWorldType, biome = StoneBiome, generationProfile = DefaultDungeonProfile,
                mapWidth = mapWidth, mapHeight = mapHeight,
                generatorSettings = new GeneratorSettings { dungeon = new DungeonGeneratorSettings { maxDepth = 5, minLeafSize = 10 } },
                propSettings = DisabledProps(), visualSettings = DefaultVisuals(), presentationSettings = DefaultPresentation(), layoutSettings = DefaultLayout(), specialRooms = DisabledSpecialRooms()
            };
        }

        public static PCGRequest CreateCaveDefault(int seed = 12345, int mapWidth = 100, int mapHeight = 100)
        {
            return new PCGRequest
            {
                schemaVersion = CurrentSchemaVersion, generatorVersion = CaveGeneratorVersion, seed = seed,
                worldType = CaveWorldType, biome = StoneBiome, generationProfile = DefaultCaveProfile, mapWidth = mapWidth, mapHeight = mapHeight,
                generatorSettings = new GeneratorSettings { cave = new CaveGeneratorSettings { fillPercent = 46, automataSteps = 5, minimumRegionSize = 24, tunnelRadius = 1, extraTunnelCount = 1 } },
                propSettings = DisabledProps(), visualSettings = DefaultVisuals(), presentationSettings = DefaultPresentation(), layoutSettings = DefaultLayout(), specialRooms = null
            };
        }
        public static PCGRequest CreateForestDefault(int seed=12345,int mapWidth=100,int mapHeight=100) => new PCGRequest { schemaVersion=CurrentSchemaVersion,generatorVersion=ForestGeneratorVersion,seed=seed,worldType=ForestWorldType,biome=TemperateBiome,generationProfile=DefaultForestProfile,mapWidth=mapWidth,mapHeight=mapHeight,generatorSettings=new GeneratorSettings { forest=new ForestGeneratorSettings { waterThreshold=.20f,noiseOctaves=4,clearingRadius=14f,vegetationMinDistance=4f,vegetationMaxCount=600,elevationScale=6f,elevationFrequency=.035f } },propSettings=DisabledProps(),visualSettings=DefaultVisuals(),presentationSettings=DefaultPresentation(),layoutSettings=DefaultLayout(),specialRooms=null };
        public static PCGRequest CreateCityDefault(int seed=12345,int mapWidth=100,int mapHeight=100) => new PCGRequest { schemaVersion=CurrentSchemaVersion,generatorVersion=CityGeneratorVersion,seed=seed,worldType=CityWorldType,biome=TemperateBiome,generationProfile=DefaultCityProfile,mapWidth=mapWidth,mapHeight=mapHeight,generatorSettings=new GeneratorSettings { city=new CityGeneratorSettings { hubMinDistance=20f,hubMaxCount=8,roadWidth=2,extraLoopCount=2,wfcBacktrackLimit=64,wfcRestartLimit=2,buildingMinHeight=4f,buildingMaxHeight=16f } },propSettings=DisabledProps(),visualSettings=DefaultVisuals(),presentationSettings=DefaultPresentation(),layoutSettings=DefaultLayout(),specialRooms=null };
        public static PCGRequest CreateSwampDefault(int seed=12345,int mapWidth=100,int mapHeight=100) => CreateNatureDefault(seed,mapWidth,mapHeight,SwampGeneratorVersion,SwampWorldType,WetlandBiome,DefaultSwampProfile,.46f,4,12f,4.5f,500,3.5f,.03f);
        public static PCGRequest CreateSnowfieldDefault(int seed=12345,int mapWidth=100,int mapHeight=100) => CreateNatureDefault(seed,mapWidth,mapHeight,SnowfieldGeneratorVersion,SnowfieldWorldType,ArcticBiome,DefaultSnowfieldProfile,.18f,4,16f,6f,320,8f,.025f);
        public static PCGRequest CreateDesertDefault(int seed=12345,int mapWidth=100,int mapHeight=100) => CreateNatureDefault(seed,mapWidth,mapHeight,DesertGeneratorVersion,DesertWorldType,AridBiome,DefaultDesertProfile,.08f,4,18f,8f,180,10f,.018f);

        private static PCGRequest CreateNatureDefault(int seed,int mapWidth,int mapHeight,string generatorVersion,string worldType,string biome,string profile,float waterThreshold,int noiseOctaves,float clearingRadius,float vegetationMinDistance,int vegetationMaxCount,float elevationScale,float elevationFrequency) => new PCGRequest { schemaVersion=CurrentSchemaVersion,generatorVersion=generatorVersion,seed=seed,worldType=worldType,biome=biome,generationProfile=profile,mapWidth=mapWidth,mapHeight=mapHeight,generatorSettings=new GeneratorSettings { forest=new ForestGeneratorSettings { waterThreshold=waterThreshold,noiseOctaves=noiseOctaves,clearingRadius=clearingRadius,vegetationMinDistance=vegetationMinDistance,vegetationMaxCount=vegetationMaxCount,elevationScale=elevationScale,elevationFrequency=elevationFrequency } },propSettings=DisabledProps(),visualSettings=DefaultVisuals(),presentationSettings=DefaultPresentation(),layoutSettings=DefaultLayout(),specialRooms=null };

        public static PropSettings DisabledProps() => new PropSettings { enabled = false, density = 0f, maxCount = 0, allowedTypes = Array.Empty<string>() };
        public static VisualSettings DefaultVisuals() => new VisualSettings
        {
            trees = DefaultVisualCategory(), rocks = DefaultVisualCategory(), bushes = DefaultVisualCategory(),
            groundDetails = DefaultVisualCategory(), waterProps = DefaultVisualCategory()
        };
        public static VisualCategorySettings DefaultVisualCategory() => new VisualCategorySettings { density = 1f, maxCount = 0, allowedTypes = Array.Empty<string>() };
        public static PresentationSettings DefaultPresentation() => new PresentationSettings { geometryMode = PresentationGeometryModes.Surface, propsEnabled = true };
        public static LayoutSettings DefaultLayout() => new LayoutSettings
        {
            landform = new LandformLayoutSettings { kind = SpatialLayoutValues.None, placement = SpatialLayoutValues.Seeded, size = SpatialLayoutValues.Medium, intensity = SpatialLayoutValues.Medium },
            water = new WaterLayoutSettings { kind = SpatialLayoutValues.Default, placement = SpatialLayoutValues.Seeded, size = SpatialLayoutValues.Medium, meander = SpatialLayoutValues.Low, exclusive = false },
            route = new RouteLayoutSettings { kind = SpatialLayoutValues.Default, placement = SpatialLayoutValues.Seeded, size = SpatialLayoutValues.Medium, orientation = SpatialLayoutValues.Seeded, meander = SpatialLayoutValues.Low }
        };
        public static SpecialRoomsSettings DisabledSpecialRooms() => new SpecialRoomsSettings
        {
            boss = new BossRoomSettings { enabled = false, count = 0, placement = "FarthestFromStart" },
            treasure = new RoomSelectionSettings { enabled = false, count = 0, placement = "FarthestFromStart" },
            shop = new RoomSelectionSettings { enabled = false, count = 0, placement = "FarthestFromStart" },
            secret = new RoomSelectionSettings { enabled = false, count = 0, placement = "FarthestFromStart" }
        };
    }

    [Serializable] public sealed class GeneratorSettings { public DungeonGeneratorSettings dungeon; public CityGeneratorSettings city; public ForestGeneratorSettings forest; public CaveGeneratorSettings cave; }
    [Serializable] public sealed class DungeonGeneratorSettings { public int maxDepth; public int minLeafSize; }
    [Serializable] public sealed class CaveGeneratorSettings { public int fillPercent; public int automataSteps; public int minimumRegionSize; public int tunnelRadius; public int extraTunnelCount; }
    [Serializable] public sealed class ForestGeneratorSettings { public float waterThreshold; public int noiseOctaves; public float clearingRadius; public float vegetationMinDistance; public int vegetationMaxCount; public float elevationScale; public float elevationFrequency; }
    [Serializable] public sealed class CityGeneratorSettings { public float hubMinDistance; public int hubMaxCount; public int roadWidth; public int extraLoopCount; public int wfcBacktrackLimit; public int wfcRestartLimit; public float buildingMinHeight; public float buildingMaxHeight; }
    [Serializable] public sealed class PropSettings { public bool enabled; public float density; public int maxCount; public string[] allowedTypes; }
    [Serializable] public sealed class VisualSettings { public VisualCategorySettings trees; public VisualCategorySettings rocks; public VisualCategorySettings bushes; public VisualCategorySettings groundDetails; public VisualCategorySettings waterProps; }
    [Serializable] public sealed class VisualCategorySettings { public float density; public int maxCount; public string[] allowedTypes; }
    [Serializable] public sealed class PresentationSettings { public string geometryMode; public bool propsEnabled; }
    [Serializable] public sealed class LayoutSettings { public LandformLayoutSettings landform; public WaterLayoutSettings water; public RouteLayoutSettings route; }
    [Serializable] public sealed class LandformLayoutSettings { public string kind; public string placement; public string size; public string intensity; }
    [Serializable] public sealed class WaterLayoutSettings { public string kind; public string placement; public string size; public string meander; public bool exclusive; }
    [Serializable] public sealed class RouteLayoutSettings { public string kind; public string placement; public string size; public string orientation; public string meander; }
    [Serializable] public sealed class SpecialRoomsSettings { public BossRoomSettings boss; public RoomSelectionSettings treasure; public RoomSelectionSettings shop; public RoomSelectionSettings secret; }
    [Serializable] public sealed class BossRoomSettings { public bool enabled; public int count; public string placement; }
    [Serializable] public sealed class RoomSelectionSettings { public bool enabled; public int count; public string placement; }

    public static class SpatialLayoutValues
    {
        public const string None = "None";
        public const string Default = "Default";
        public const string Mountain = "Mountain";
        public const string Lake = "Lake";
        public const string River = "River";
        public const string Road = "Road";
        public const string Path = "Path";
        public const string Center = "Center";
        public const string CenterCrossing = "CenterCrossing";
        public const string Seeded = "Seeded";
        public const string Horizontal = "Horizontal";
        public const string Vertical = "Vertical";
        public const string Small = "Small";
        public const string Medium = "Medium";
        public const string Large = "Large";
        public const string Low = "Low";
        public const string High = "High";
    }

    public static class PresentationGeometryModes
    {
        public const string Voxel = "Voxel";
        public const string Surface = "Surface";
    }

    public readonly struct PCGValidationResult
    {
        public readonly string Code; public readonly string Message; public bool IsValid => string.IsNullOrEmpty(Code);
        private PCGValidationResult(string code, string message) { Code = code; Message = message; }
        public static PCGValidationResult Valid() => new PCGValidationResult(null, null);
        public static PCGValidationResult Invalid(string code, string message) => new PCGValidationResult(code, message);
    }

    /// <summary>Deterministic in-memory v1/v2 normalization into the v3 presentation contract.</summary>
    public static class PCGRequestUpgrader
    {
        public static PCGValidationResult UpgradeInPlace(PCGRequest request)
        {
            if (request == null) return PCGValidationResult.Invalid("INVALID_REQUEST", "Request body is missing or malformed.");
            int sourceSchemaVersion = request.schemaVersion;
            if (request.schemaVersion == 1)
            {
                if (!string.Equals(request.worldType, PCGRequest.DungeonWorldType, StringComparison.Ordinal)) return PCGValidationResult.Invalid("UNSUPPORTED_SCHEMA_VERSION", "Only legacy Dungeon requests can be upgraded.");
                request.generatorVersion = PCGRequest.DungeonGeneratorVersion;
                if (request.generatorSettings == null) request.generatorSettings = new GeneratorSettings();
                if (request.propSettings == null) request.propSettings = PCGRequest.DisabledProps();
                if (request.specialRooms == null) request.specialRooms = PCGRequest.DisabledSpecialRooms();
                if (request.specialRooms.boss == null) request.specialRooms.boss = PCGRequest.DisabledSpecialRooms().boss;
                if (request.specialRooms.treasure == null) request.specialRooms.treasure = PCGRequest.DisabledSpecialRooms().treasure;
                if (request.specialRooms.shop == null) request.specialRooms.shop = PCGRequest.DisabledSpecialRooms().shop;
                if (request.specialRooms.secret == null) request.specialRooms.secret = PCGRequest.DisabledSpecialRooms().secret;
            }
            else if (request.schemaVersion != 2 && request.schemaVersion != PCGRequest.CurrentSchemaVersion)
                return PCGValidationResult.Invalid("UNSUPPORTED_SCHEMA_VERSION", "Supported schemaVersion values are 1, 2, and 3.");

            request.schemaVersion = PCGRequest.CurrentSchemaVersion;
            // JsonUtility can materialize omitted nested serializable objects. Normalize those empty
            // inactive branches so the wire contract still has exactly one active generator setting.
            if (request.generatorSettings != null)
            {
                if (Empty(request.generatorSettings.city)) request.generatorSettings.city = null;
                if (Empty(request.generatorSettings.forest)) request.generatorSettings.forest = null;
                if (Empty(request.generatorSettings.cave)) request.generatorSettings.cave = null;
                if (Empty(request.generatorSettings.dungeon)) request.generatorSettings.dungeon = null;
                // Defaults for missing elevation fields belong to legacy payloads only.
                if (sourceSchemaVersion < PCGRequest.CurrentSchemaVersion) NormalizeActiveSettings(request);
            }
            NormalizeVisualSettings(request);
            NormalizePresentationSettings(request);
            NormalizeLayoutSettings(request);
            return PCGValidationResult.Valid();
        }

        private static void NormalizeActiveSettings(PCGRequest request)
        {
            if (request.generatorSettings == null) return;
            ForestGeneratorSettings forest = request.generatorSettings.forest;
            if (forest != null)
            {
                if (forest.elevationScale <= 0f) forest.elevationScale = 6f;
                if (forest.elevationFrequency <= 0f) forest.elevationFrequency = .035f;
            }
            CityGeneratorSettings city = request.generatorSettings.city;
            if (city != null)
            {
                if (city.buildingMinHeight <= 0f) city.buildingMinHeight = 4f;
                if (city.buildingMaxHeight <= 0f) city.buildingMaxHeight = 16f;
            }
        }

        private static void NormalizeVisualSettings(PCGRequest request)
        {
            if (request.visualSettings == null) request.visualSettings = PCGRequest.DefaultVisuals();
            if (request.visualSettings.trees == null) request.visualSettings.trees = PCGRequest.DefaultVisualCategory();
            if (request.visualSettings.rocks == null) request.visualSettings.rocks = PCGRequest.DefaultVisualCategory();
            if (request.visualSettings.bushes == null) request.visualSettings.bushes = PCGRequest.DefaultVisualCategory();
            if (request.visualSettings.groundDetails == null) request.visualSettings.groundDetails = PCGRequest.DefaultVisualCategory();
            if (request.visualSettings.waterProps == null) request.visualSettings.waterProps = PCGRequest.DefaultVisualCategory();
        }

        private static void NormalizeLayoutSettings(PCGRequest request)
        {
            LayoutSettings defaults = PCGRequest.DefaultLayout();
            if (request.layoutSettings == null) request.layoutSettings = defaults;
            if (request.layoutSettings.landform == null) request.layoutSettings.landform = defaults.landform;
            if (request.layoutSettings.water == null) request.layoutSettings.water = defaults.water;
            if (request.layoutSettings.route == null) request.layoutSettings.route = defaults.route;
        }

        private static void NormalizePresentationSettings(PCGRequest request)
        {
            if (request.presentationSettings == null || string.IsNullOrWhiteSpace(request.presentationSettings.geometryMode))
                request.presentationSettings = PCGRequest.DefaultPresentation();
        }

        private static bool Empty(DungeonGeneratorSettings s) => s != null && s.maxDepth == 0 && s.minLeafSize == 0;
        private static bool Empty(CityGeneratorSettings s) => s != null && s.hubMinDistance == 0f && s.hubMaxCount == 0 && s.roadWidth == 0 && s.extraLoopCount == 0 && s.wfcBacktrackLimit == 0 && s.wfcRestartLimit == 0 && s.buildingMinHeight == 0f && s.buildingMaxHeight == 0f;
        private static bool Empty(ForestGeneratorSettings s) => s != null && s.waterThreshold == 0f && s.noiseOctaves == 0 && s.clearingRadius == 0f && s.vegetationMinDistance == 0f && s.vegetationMaxCount == 0 && s.elevationScale == 0f && s.elevationFrequency == 0f;
        private static bool Empty(CaveGeneratorSettings s) => s != null && s.fillPercent == 0 && s.automataSteps == 0 && s.minimumRegionSize == 0 && s.tunnelRadius == 0 && s.extraTunnelCount == 0;
    }

    public static class PCGRequestValidator
    {
        public static PCGValidationResult Validate(PCGRequest request)
        {
            PCGValidationResult upgrade = PCGRequestUpgrader.UpgradeInPlace(request);
            if (!upgrade.IsValid) return upgrade;
            if (request.schemaVersion != PCGRequest.CurrentSchemaVersion) return PCGValidationResult.Invalid("UNSUPPORTED_SCHEMA_VERSION", "Only schemaVersion 3 is supported after upgrade.");
            if (request.mapWidth < 16 || request.mapHeight < 16 || request.mapWidth > 500 || request.mapHeight > 500) return PCGValidationResult.Invalid("INVALID_MAP_SIZE", "mapWidth and mapHeight must both be in 16..500.");
            if (!IsWorldType(request.worldType)) return PCGValidationResult.Invalid("UNSUPPORTED_WORLD_TYPE", "worldType must be Dungeon, City, Forest, Cave, Swamp, Snowfield, or Desert.");
            if (request.generatorSettings == null) return PCGValidationResult.Invalid("MISSING_GENERATOR_SETTINGS", "generatorSettings is required.");
            if (!ValidateProps(request.propSettings, out PCGValidationResult props)) return props;
            if (!ValidateVisuals(request.visualSettings, out PCGValidationResult visuals)) return visuals;
            if (!ValidatePresentation(request.presentationSettings, out PCGValidationResult presentation)) return presentation;
            if (!ValidateLayout(request.layoutSettings, request.worldType, out PCGValidationResult layout)) return layout;
            if (string.Equals(request.worldType, PCGRequest.DungeonWorldType, StringComparison.Ordinal)) return ValidateDungeon(request);
            if (string.Equals(request.worldType, PCGRequest.CaveWorldType, StringComparison.Ordinal)) return ValidateCave(request);
            if (string.Equals(request.worldType, PCGRequest.ForestWorldType, StringComparison.Ordinal)) return ValidateForest(request);
            if (string.Equals(request.worldType, PCGRequest.CityWorldType, StringComparison.Ordinal)) return ValidateCity(request);
            if (string.Equals(request.worldType, PCGRequest.SwampWorldType, StringComparison.Ordinal)) return ValidateNature(request, PCGRequest.SwampGeneratorVersion, PCGRequest.WetlandBiome, PCGRequest.DefaultSwampProfile, PCGRequest.OpenMarshProfile, PCGRequest.DenseBogProfile);
            if (string.Equals(request.worldType, PCGRequest.SnowfieldWorldType, StringComparison.Ordinal)) return ValidateNature(request, PCGRequest.SnowfieldGeneratorVersion, PCGRequest.ArcticBiome, PCGRequest.DefaultSnowfieldProfile, PCGRequest.SparseTundraProfile, PCGRequest.FrozenGroveProfile);
            if (string.Equals(request.worldType, PCGRequest.DesertWorldType, StringComparison.Ordinal)) return ValidateNature(request, PCGRequest.DesertGeneratorVersion, PCGRequest.AridBiome, PCGRequest.DefaultDesertProfile, PCGRequest.DuneSeaProfile, PCGRequest.OasisDesertProfile);
            return PCGValidationResult.Invalid("UNSUPPORTED_WORLD_TYPE", "worldType must be Dungeon, City, Forest, Cave, Swamp, Snowfield, or Desert.");
        }

        private static PCGValidationResult ValidateDungeon(PCGRequest r)
        {
            if (!string.Equals(r.generatorVersion, PCGRequest.DungeonGeneratorVersion, StringComparison.Ordinal)) return PCGValidationResult.Invalid("UNSUPPORTED_GENERATOR_VERSION", "Dungeon requires dungeon-bsp@1.");
            if (!string.Equals(r.biome, PCGRequest.StoneBiome, StringComparison.Ordinal) || !IsOneOf(r.generationProfile, PCGRequest.DefaultDungeonProfile, PCGRequest.CompactDungeonProfile, PCGRequest.SprawlingDungeonProfile)) return PCGValidationResult.Invalid("UNSUPPORTED_GENERATION_PROFILE", "Invalid Dungeon biome or profile.");
            if (r.generatorSettings.dungeon == null || r.generatorSettings.city != null || r.generatorSettings.forest != null || r.generatorSettings.cave != null) return PCGValidationResult.Invalid("INVALID_GENERATOR_SETTINGS", "Dungeon requires exactly generatorSettings.dungeon.");
            if (r.generatorSettings.dungeon.maxDepth < 1 || r.generatorSettings.dungeon.maxDepth > 12) return PCGValidationResult.Invalid("INVALID_MAX_DEPTH", "generatorSettings.dungeon.maxDepth must be in 1..12.");
            if (r.generatorSettings.dungeon.minLeafSize < 3 || r.generatorSettings.dungeon.minLeafSize > 200 || r.generatorSettings.dungeon.minLeafSize >= r.mapWidth || r.generatorSettings.dungeon.minLeafSize >= r.mapHeight) return PCGValidationResult.Invalid("INVALID_MIN_LEAF_SIZE", "minLeafSize must be in 3..200 and smaller than both map dimensions.");
            if (r.specialRooms == null || !ValidRoom(r.specialRooms.boss) || !ValidRoom(r.specialRooms.treasure) || !ValidRoom(r.specialRooms.shop) || !ValidRoom(r.specialRooms.secret)) return PCGValidationResult.Invalid("MISSING_SPECIAL_ROOMS", "Dungeon special room settings are required.");
            return PCGValidationResult.Valid();
        }
        private static PCGValidationResult ValidateCave(PCGRequest r)
        {
            CaveGeneratorSettings s = r.generatorSettings.cave;
            // A legacy Dungeon payload whose caller only changes worldType remains an unsupported
            // world request; it must not silently become a malformed Cave request.
            if (string.Equals(r.generatorVersion, PCGRequest.DungeonGeneratorVersion, StringComparison.Ordinal)) return PCGValidationResult.Invalid("UNSUPPORTED_WORLD_TYPE", "Dungeon settings cannot be used to request Cave.");
            if (!string.Equals(r.generatorVersion, PCGRequest.CaveGeneratorVersion, StringComparison.Ordinal) || !string.Equals(r.biome, PCGRequest.StoneBiome, StringComparison.Ordinal) || !IsOneOf(r.generationProfile, PCGRequest.DefaultCaveProfile, PCGRequest.CavernousCaveProfile, PCGRequest.TightCaveProfile) || s == null || r.generatorSettings.dungeon != null || r.generatorSettings.city != null || r.generatorSettings.forest != null) return PCGValidationResult.Invalid("INVALID_GENERATOR_SETTINGS", "Cave requires exactly generatorSettings.cave and a Cave profile.");
            if (!(s.fillPercent >= 20 && s.fillPercent <= 80 && s.automataSteps >= 1 && s.automataSteps <= 12 && s.minimumRegionSize >= 1 && s.minimumRegionSize <= 1000 && s.tunnelRadius >= 1 && s.tunnelRadius <= 5 && s.extraTunnelCount >= 0 && s.extraTunnelCount <= 16)) return PCGValidationResult.Invalid("INVALID_CAVE_SETTINGS", "Cave settings are out of range.");
            return PCGValidationResult.Valid();
        }
        private static PCGValidationResult ValidateForest(PCGRequest r)
        {
            ForestGeneratorSettings s = r.generatorSettings.forest;
            if (!string.Equals(r.generatorVersion, PCGRequest.ForestGeneratorVersion, StringComparison.Ordinal) || !string.Equals(r.biome, PCGRequest.TemperateBiome, StringComparison.Ordinal) || !IsOneOf(r.generationProfile, PCGRequest.DefaultForestProfile, PCGRequest.DenseForestProfile, PCGRequest.MeadowForestProfile) || s == null || r.generatorSettings.dungeon != null || r.generatorSettings.city != null || r.generatorSettings.cave != null) return PCGValidationResult.Invalid("INVALID_GENERATOR_SETTINGS", "Forest requires exactly generatorSettings.forest and a Forest profile.");
            return ValidForestNumbers(s) ? PCGValidationResult.Valid() : PCGValidationResult.Invalid("INVALID_FOREST_SETTINGS", "Forest settings are out of range.");
        }
        private static PCGValidationResult ValidateCity(PCGRequest r)
        {
            CityGeneratorSettings s = r.generatorSettings.city;
            if (!string.Equals(r.generatorVersion, PCGRequest.CityGeneratorVersion, StringComparison.Ordinal) || !string.Equals(r.biome, PCGRequest.TemperateBiome, StringComparison.Ordinal) || !IsOneOf(r.generationProfile, PCGRequest.DefaultCityProfile, PCGRequest.GridCityProfile, PCGRequest.OrganicCityProfile) || s == null || r.generatorSettings.dungeon != null || r.generatorSettings.forest != null || r.generatorSettings.cave != null) return PCGValidationResult.Invalid("INVALID_GENERATOR_SETTINGS", "City requires exactly generatorSettings.city and a City profile.");
            if (!(s.hubMinDistance > 0f && s.hubMinDistance <= 128f && s.hubMaxCount >= 2 && s.hubMaxCount <= 64 && s.roadWidth >= 1 && s.roadWidth <= 8 && s.extraLoopCount >= 0 && s.extraLoopCount <= 32 && s.wfcBacktrackLimit >= 0 && s.wfcBacktrackLimit <= 10000 && s.wfcRestartLimit >= 0 && s.wfcRestartLimit <= 32 && s.buildingMinHeight >= 1f && s.buildingMaxHeight >= s.buildingMinHeight && s.buildingMaxHeight <= 128f)) return PCGValidationResult.Invalid("INVALID_CITY_SETTINGS", "City settings are out of range.");
            return PCGValidationResult.Valid();
        }
        private static PCGValidationResult ValidateNature(PCGRequest r, string generatorVersion, string biome, string defaultProfile, string profileA, string profileB)
        {
            ForestGeneratorSettings s = r.generatorSettings.forest;
            if (!string.Equals(r.generatorVersion, generatorVersion, StringComparison.Ordinal) || !string.Equals(r.biome, biome, StringComparison.Ordinal) || !IsOneOf(r.generationProfile, defaultProfile, profileA, profileB) || s == null || r.generatorSettings.dungeon != null || r.generatorSettings.city != null || r.generatorSettings.cave != null)
                return PCGValidationResult.Invalid("INVALID_GENERATOR_SETTINGS", r.worldType + " requires exactly generatorSettings.forest and a matching Nature profile.");
            return ValidForestNumbers(s)
                ? PCGValidationResult.Valid()
                : PCGValidationResult.Invalid("INVALID_NATURE_SETTINGS", r.worldType + " settings are out of range.");
        }
        private static bool ValidForestNumbers(ForestGeneratorSettings s) => s.waterThreshold >= 0f && s.waterThreshold <= 1f && s.noiseOctaves >= 1 && s.noiseOctaves <= 8 && s.clearingRadius > 0f && s.clearingRadius <= 64f && s.vegetationMinDistance > 0f && s.vegetationMinDistance <= 32f && s.vegetationMaxCount >= 0 && s.vegetationMaxCount <= 10000 && s.elevationScale > 0f && s.elevationScale <= 64f && s.elevationFrequency > 0f && s.elevationFrequency <= 1f;
        private static bool ValidateProps(PropSettings s, out PCGValidationResult result)
        {
            bool valid = s != null && s.density >= 0f && s.density <= 1f && s.maxCount >= 0 && s.allowedTypes != null;
            if (valid) for (int i = 0; i < s.allowedTypes.Length; i++) if (!OneOf(s.allowedTypes[i], "Pillar", "Crate", "Crystal", "Torch")) valid = false;
            result = valid ? PCGValidationResult.Valid() : PCGValidationResult.Invalid("INVALID_PROP_SETTINGS", "propSettings is invalid.");
            return valid;
        }
        private static bool ValidateVisuals(VisualSettings s, out PCGValidationResult result)
        {
            result = s != null && ValidVisualCategory(s.trees, "cherry_blossom", "broadleaf", "conifer", "willow", "dead_tree", "palm", "cactus") && ValidVisualCategory(s.rocks, "rock", "ice") && ValidVisualCategory(s.bushes, "bush", "reeds") && ValidVisualCategory(s.groundDetails, "grass", "flower", "plant", "mushroom", "stump", "log", "branch", "thorn") && ValidVisualCategory(s.waterProps, "lily_pad", "water_lily", "reeds", "palm", "ice")
                ? PCGValidationResult.Valid()
                : PCGValidationResult.Invalid("INVALID_VISUAL_SETTINGS", "visualSettings density must be 0..1, maxCount must be non-negative, and allowedTypes must use supported canonical names.");
            return result.IsValid;
        }
        private static bool ValidatePresentation(PresentationSettings s, out PCGValidationResult result)
        {
            result = s != null && OneOf(s.geometryMode, PresentationGeometryModes.Voxel, PresentationGeometryModes.Surface)
                ? PCGValidationResult.Valid()
                : PCGValidationResult.Invalid("INVALID_PRESENTATION_SETTINGS", "presentationSettings.geometryMode must be Voxel or Surface.");
            return result.IsValid;
        }
        private static bool ValidateLayout(LayoutSettings s, string worldType, out PCGValidationResult result)
        {
            LandformLayoutSettings land = s?.landform;
            bool neutral = land != null && land.kind == SpatialLayoutValues.None && land.placement == SpatialLayoutValues.Seeded && land.size == SpatialLayoutValues.Medium && land.intensity == SpatialLayoutValues.Medium;
            bool mountain = land != null && land.kind == SpatialLayoutValues.Mountain &&
                OneOf(worldType, PCGRequest.ForestWorldType, PCGRequest.SwampWorldType, PCGRequest.SnowfieldWorldType, PCGRequest.DesertWorldType) &&
                OneOf(land.placement, "Seeded", "Center", "North", "South", "East", "West") &&
                OneOf(land.size, "Small", "Medium", "Large") && OneOf(land.intensity, "Low", "Medium", "High");
            WaterLayoutSettings water = s?.water;
            bool defaultWater = water != null && water.kind == SpatialLayoutValues.Default && water.placement == SpatialLayoutValues.Seeded && water.size == SpatialLayoutValues.Medium && water.meander == SpatialLayoutValues.Low && !water.exclusive;
            bool river = water != null && water.kind == SpatialLayoutValues.River &&
                OneOf(worldType, PCGRequest.ForestWorldType, PCGRequest.SwampWorldType, PCGRequest.SnowfieldWorldType, PCGRequest.DesertWorldType) &&
                OneOf(water.placement, "CenterNorthSouth", "CenterEastWest") && OneOf(water.size, "Small", "Medium", "Large") && water.meander == SpatialLayoutValues.Low;
            bool valid = s != null && s.landform != null && s.water != null && s.route != null &&
                (neutral || mountain) &&
                (defaultWater || river) &&
                s.route.kind == SpatialLayoutValues.Default && s.route.placement == SpatialLayoutValues.Seeded && s.route.size == SpatialLayoutValues.Medium && s.route.orientation == SpatialLayoutValues.Seeded && s.route.meander == SpatialLayoutValues.Low;
            result = valid ? PCGValidationResult.Valid() : PCGValidationResult.Invalid("UNSUPPORTED_LAYOUT_SETTINGS", "Nature worlds support Mountain and central NorthSouth/EastWest River layouts. Route must use neutral layoutSettings.");
            return valid;
        }
        private static bool OneOf(string value, params string[] choices) { for (int index = 0; index < choices.Length; index++) if (string.Equals(value, choices[index], StringComparison.Ordinal)) return true; return false; }
        private static bool ValidVisualCategory(VisualCategorySettings s, params string[] supported)
        {
            if (s == null || !(s.density >= 0f && s.density <= 1f) || s.maxCount < 0 || s.allowedTypes == null) return false;
            for (int index = 0; index < s.allowedTypes.Length; index++) if (!OneOf(s.allowedTypes[index], supported)) return false;
            return true;
        }
        private static bool ValidRoom(BossRoomSettings s) => s != null && s.count >= 0 && !string.IsNullOrWhiteSpace(s.placement);
        private static bool ValidRoom(RoomSelectionSettings s) => s != null && s.count >= 0 && !string.IsNullOrWhiteSpace(s.placement);
        private static bool IsOneOf(string value, string a, string b, string c) => string.Equals(value, a, StringComparison.Ordinal) || string.Equals(value, b, StringComparison.Ordinal) || string.Equals(value, c, StringComparison.Ordinal);
        private static bool IsWorldType(string value) => string.Equals(value, PCGRequest.DungeonWorldType, StringComparison.Ordinal) || string.Equals(value, PCGRequest.CityWorldType, StringComparison.Ordinal) || string.Equals(value, PCGRequest.ForestWorldType, StringComparison.Ordinal) || string.Equals(value, PCGRequest.CaveWorldType, StringComparison.Ordinal) || string.Equals(value, PCGRequest.SwampWorldType, StringComparison.Ordinal) || string.Equals(value, PCGRequest.SnowfieldWorldType, StringComparison.Ordinal) || string.Equals(value, PCGRequest.DesertWorldType, StringComparison.Ordinal);
    }
}

using System;
using System.Collections.Generic;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;

namespace Llm2Pcg.Tests
{
    // Shared by Unity EditMode and the standalone --self-test; no Unity/NUnit dependency.
    public static class PcgCoreRegressionChecks
    {
        public static void Run()
        {
            NoiseRounding(); SpacingMatchesBruteForce(); NumericGuards(); MapGuards();
            LegacyDefaults(); DungeonOutcomeDiagnostics(); NavigableEndpoints(); TerrainLandforms(); RiverLayouts();
        }

        private static void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }

        public static void TerrainLandforms()
        {
            foreach (PCGRequest request in new[] { PCGRequest.CreateForestDefault(234,128,128), PCGRequest.CreateSwampDefault(234,128,128), PCGRequest.CreateSnowfieldDefault(234,128,128), PCGRequest.CreateDesertDefault(234,128,128) })
            {
                BiomeWorldData baseline = GenerateBiome(request);
                request.layoutSettings.landform = new LandformLayoutSettings { kind="Mountain", placement="Center", size="Large", intensity="High" };
                BiomeWorldData raised = GenerateBiome(request);
                Require(raised.ComputeStableHash() == GenerateBiome(request).ComputeStableHash(), request.worldType + " mountain replay changed.");
                Require(raised.ComputeStableHash() != baseline.ComputeStableHash(), request.worldType + " ignored mountain.");
                float center = raised.GetSurfaceHeight(64,64);
                Require(center > 20f && center > baseline.GetSurfaceHeight(64,64) + 15f, request.worldType + " summit not raised.");
                Require(raised.GetSurfaceHeight(0,0) == baseline.GetSurfaceHeight(0,0), "Landform changed background outside its footprint.");
                Require(raised.IsWalkable(64,64), "Summit is water.");
                foreach (float value in raised.Elevations) Require(value <= center && value * 4f == Math.Round(value * 4f), "Summit location/quantization mismatch.");
                foreach (Int2 point in raised.Props) Require(raised.Tiles[point.Y*raised.Width+point.X] == BiomeTile.Ground, "Mountain vegetation intersects water/path.");
                request.layoutSettings.landform.intensity="Low";
                Require(GenerateBiome(request).GetSurfaceHeight(64,64) < center, "Height control ignored.");
                request.layoutSettings.landform.size="Small";
                Require(GenerateBiome(request).GetSurfaceHeight(90,64) == baseline.GetSurfaceHeight(90,64), "Small mountain footprint too wide.");
            }
            foreach (string placement in new[] { "Center", "North", "South", "East", "West", "Seeded" })
            {
                PCGRequest request = PCGRequest.CreateForestDefault(-17,96,64);
                request.layoutSettings.landform = new LandformLayoutSettings { kind="Mountain", placement=placement, size="Large", intensity="High" };
                BiomeWorldData world = GenerateBiome(request);
                Require(world.ComputeStableHash() == GenerateBiome(request).ComputeStableHash(), "Placement replay mismatch.");
                int cx=placement=="East"?72:placement=="West"?24:48;
                int cy=placement=="North"?48:placement=="South"?16:32;
                if(placement!="Seeded") foreach(float value in world.Elevations) Require(value <= world.GetSurfaceHeight(cx,cy), "Wrong cardinal summit: " + placement);
            }
            foreach (int width in new[] {16,500})
            {
                PCGRequest request=PCGRequest.CreateForestDefault(int.MinValue,width,width==16?500:16);
                request.layoutSettings.landform=new LandformLayoutSettings {kind="Mountain",placement="Seeded",size="Large",intensity="High"};
                Require(GenerateBiome(request).Elevations.Length==8000,"Rectangular boundary generation failed.");
            }
            foreach (PCGRequest request in new[] {PCGRequest.CreateDefault(),PCGRequest.CreateCityDefault(),PCGRequest.CreateCaveDefault()})
            {
                request.layoutSettings.landform.kind="Mountain";
                Require(!PCGRequestValidator.Validate(request).IsValid,"Unsupported world accepted a mountain.");
            }
        }

        private static BiomeWorldData GenerateBiome(PCGRequest request) => (BiomeWorldData)PCGGeneratorRegistry.Default.GetRequired(request).Generate(request);

        public static void RiverLayouts()
        {
            foreach (int seed in new[] { 234, -17, int.MinValue })
            foreach (PCGRequest request in new[] { PCGRequest.CreateForestDefault(seed,64,96), PCGRequest.CreateSwampDefault(seed,64,96), PCGRequest.CreateSnowfieldDefault(seed,64,96), PCGRequest.CreateDesertDefault(seed,64,96) })
            foreach (string placement in new[] { "CenterNorthSouth", "CenterEastWest" })
            foreach (string size in new[] { "Small", "Medium", "Large" })
            {
                request.layoutSettings.water = new WaterLayoutSettings { kind="River", placement=placement, size=size, meander="Low", exclusive=true };
                BiomeWorldData world = GenerateBiome(request);
                Require(world.ComputeStableHash() == GenerateBiome(request).ComputeStableHash(), "River replay mismatch.");
                bool ns = placement == "CenterNorthSouth";
                int span = ns ? world.Width : world.Height;
                int percent = size == "Small" ? 3 : size == "Large" ? 9 : 5;
                int half = Math.Max(1, span * percent / 200);
                for (int y=0; y<world.Height; y++)
                for (int x=0; x<world.Width; x++)
                {
                    int index=y*world.Width+x;
                    bool river = Math.Abs((ns?x:y)-span/2)<=half;
                    Require((world.Tiles[index]==BiomeTile.Water)==river, request.worldType+" river continuity/exclusive scope broken.");
                    if(river) Require(world.Elevations[index]==0f,"River surface is not level.");
                }
                foreach(Int2 point in world.Props) Require(world.Tiles[point.Y*world.Width+point.X]==BiomeTile.Ground,"River vegetation is in water.");
                Require(world.IsWalkable(world.StartPosition.X,world.StartPosition.Y)&&world.IsWalkable(world.ExitPosition.X,world.ExitPosition.Y),"River endpoint is in water.");
            }
            foreach (PCGRequest request in new[] { PCGRequest.CreateDefault(), PCGRequest.CreateCityDefault(), PCGRequest.CreateCaveDefault() })
            {
                request.layoutSettings.water = new WaterLayoutSettings { kind="River",placement="CenterNorthSouth",size="Medium",meander="Low" };
                Require(!PCGRequestValidator.Validate(request).IsValid,"Unsupported world accepted river geometry.");
            }
        }

        public static void NoiseRounding()
        {
            Require(PcgSeed.NoiseScale(.08f) == 13, "0.08 float reciprocal must round in explicit double precision.");
            Require(PcgSeed.NoiseScale(.016f) == 62, "0.016 boundary regression.");
            Require(PcgSeed.NoiseScale(.025f) == 40, "0.025 boundary regression.");
            Require(PcgSeed.NoiseScale(.001f) == 1000, "Minimum frequency regression.");
            Require(PcgSeed.NoiseScale(1f) == 3, "Minimum scale regression.");
        }

        public static void SpacingMatchesBruteForce()
        {
            foreach (int distance in new[] { 2, 3, 6, 32 })
            {
                var spacing = new PcgPointSpacingIndex(100, 80, distance);
                var accepted = new List<Int2>(); var random = new PcgDeterministicRandom(441);
                for (int attempt = 0; attempt < 10000; attempt++)
                {
                    int x = random.NextInt(100), y = random.NextInt(80); bool expected = true;
                    foreach (Int2 point in accepted)
                    {
                        int dx = x - point.X, dy = y - point.Y;
                        if (dx * dx + dy * dy < distance * distance) { expected = false; break; }
                    }
                    Require(spacing.CanPlace(x, y) == expected, "Spatial buckets changed candidate acceptance.");
                    if (expected) { accepted.Add(new Int2(x, y)); spacing.Add(x, y); }
                }
                Require(!spacing.CanPlace(-1, 0) && !spacing.CanPlace(100, 0), "Spacing bounds.");
            }
            var boundary = new PcgPointSpacingIndex(16, 16, 4); boundary.Add(0, 0);
            Require(boundary.CanPlace(4, 0) && !boundary.CanPlace(3, 0), "Exact minimum distance must remain allowed.");
        }

        public static void NumericGuards()
        {
            foreach (float value in new[] { float.NaN, float.PositiveInfinity, float.NegativeInfinity, -1f, 2f })
            {
                var r = PCGRequest.CreateForestDefault(); r.generatorSettings.forest.waterThreshold = value;
                Require(!PCGRequestValidator.Validate(r).IsValid, "Invalid water threshold accepted.");
                r = PCGRequest.CreateForestDefault(); r.visualSettings.trees.density = value;
                Require(!PCGRequestValidator.Validate(r).IsValid, "Invalid visual density accepted.");
            }
            var request = PCGRequest.CreateForestDefault(); request.generatorSettings.forest.noiseOctaves = 9;
            Require(!PCGRequestValidator.Validate(request).IsValid, "Unbounded noise octave count.");
            request = PCGRequest.CreateForestDefault(); request.generatorSettings.forest.vegetationMinDistance = float.PositiveInfinity;
            Require(!PCGRequestValidator.Validate(request).IsValid, "Infinite vegetation distance.");
            request = PCGRequest.CreateForestDefault(); request.visualSettings.trees.allowedTypes = new[] { "rock" };
            Require(!PCGRequestValidator.Validate(request).IsValid, "Cross-category visual type accepted.");
            request = PCGRequest.CreateDefault(); request.propSettings.allowedTypes = new[] { "Alien" };
            Require(!PCGRequestValidator.Validate(request).IsValid, "Unknown dungeon prop type accepted.");
            request = PCGRequest.CreateCaveDefault(); request.generatorSettings.cave.automataSteps = 13;
            Require(!PCGRequestValidator.Validate(request).IsValid, "Unbounded cellular iteration count.");
            request = PCGRequest.CreateCityDefault(); request.generatorSettings.city.hubMaxCount = 65;
            Require(!PCGRequestValidator.Validate(request).IsValid, "Unbounded city hub count.");
            request = PCGRequest.CreateDefault(); request.generatorSettings.dungeon.maxDepth = 13;
            Require(!PCGRequestValidator.Validate(request).IsValid, "Unbounded dungeon depth.");
        }

        public static void MapGuards()
        {
            foreach (int size in new[] { -1, 0, 1, 15, 501, int.MaxValue })
            {
                var r = PCGRequest.CreateForestDefault(mapWidth: size);
                Require(PCGRequestValidator.Validate(r).Code == "INVALID_MAP_SIZE", "Unsafe allocation size accepted.");
            }
            Require(PCGRequestValidator.Validate(PCGRequest.CreateForestDefault(mapWidth: 16, mapHeight: 500)).IsValid, "Valid boundary dimensions rejected.");
        }

        public static void LegacyDefaults()
        {
            var legacy = PCGRequest.CreateForestDefault(); legacy.schemaVersion = 2;
            legacy.generatorSettings.forest.elevationScale = 0; legacy.generatorSettings.forest.elevationFrequency = 0;
            Require(PCGRequestValidator.Validate(legacy).IsValid, "Legacy missing elevation defaults broken.");
            var current = PCGRequest.CreateForestDefault(); current.generatorSettings.forest.elevationFrequency = 0;
            Require(!PCGRequestValidator.Validate(current).IsValid, "Explicit invalid v3 frequency became a default.");
            Require(current.generatorSettings.forest.elevationFrequency == 0, "Invalid v3 request was silently repaired.");
        }

        public static void DungeonOutcomeDiagnostics()
        {
            var r = PCGRequest.CreateDefault(816, 64, 64);
            r.propSettings.enabled = true; r.propSettings.density = 1; r.propSettings.maxCount = 0;
            r.propSettings.allowedTypes = new[] { "Crate", "Pillar", "Torch" };
            var world = (DungeonWorldData)PCGGeneratorRegistry.Default.GetRequired(r).Generate(r);
            string hash = world.ComputeStableHash();
            Require(world.Props.Count == 0, "Zero cap compatibility changed.");
            Require(PCGGenerationDiagnostics.Inspect(r, world).Exists(d => d.code == "DUNGEON_PROP_ZERO_CAP"), "Missing zero-cap warning.");
            Require(world.ComputeStableHash() == hash && r.propSettings.maxCount == 0, "Diagnostics mutated generation.");
            r.propSettings.maxCount = 32;
            world = (DungeonWorldData)PCGGeneratorRegistry.Default.GetRequired(r).Generate(r);
            Require(world.Props.Count > 0 && world.Props.Count <= 32, "Positive prop cap does not produce props.");
            Require(!PCGGenerationDiagnostics.Inspect(r, world).Exists(d => d.code == "DUNGEON_PROP_ZERO_CAP"), "False zero-cap warning.");
            r.specialRooms.boss.enabled = true; r.specialRooms.boss.count = 1000;
            world = (DungeonWorldData)PCGGeneratorRegistry.Default.GetRequired(r).Generate(r);
            Require(PCGGenerationDiagnostics.Inspect(r, world).Exists(d => d.code == "SPECIAL_ROOM_COUNT_CAPPED"), "Missing special room cap warning.");
        }

        public static void NavigableEndpoints()
        {
            foreach (int seed in new[] { 0, 234, int.MinValue })
            foreach (PCGRequest r in new[] { PCGRequest.CreateDefault(seed,32,48), PCGRequest.CreateCaveDefault(seed,32,48), PCGRequest.CreateCityDefault(seed,32,48), PCGRequest.CreateForestDefault(seed,32,48), PCGRequest.CreateSwampDefault(seed,32,48), PCGRequest.CreateSnowfieldDefault(seed,32,48), PCGRequest.CreateDesertDefault(seed,32,48) })
            {
                var w = (IPCGNavigableWorldData)PCGGeneratorRegistry.Default.GetRequired(r).Generate(r);
                Require(w.IsWalkable(w.StartPosition.X,w.StartPosition.Y) && w.IsWalkable(w.ExitPosition.X,w.ExitPosition.Y), r.worldType + " endpoint blocked.");
                var visited = new bool[w.Width*w.Height]; var queue = new Queue<Int2>();
                queue.Enqueue(w.StartPosition); visited[w.StartPosition.Y*w.Width+w.StartPosition.X] = true;
                int[] dx = {0,1,0,-1}, dy = {-1,0,1,0};
                while(queue.Count>0)
                {
                    Int2 p=queue.Dequeue();
                    for(int d=0;d<4;d++) {int x=p.X+dx[d],y=p.Y+dy[d];if(x<0||y<0||x>=w.Width||y>=w.Height||!w.IsWalkable(x,y)||visited[y*w.Width+x])continue;visited[y*w.Width+x]=true;queue.Enqueue(new Int2(x,y));}
                }
                Require(visited[w.ExitPosition.Y*w.Width+w.ExitPosition.X], r.worldType + " exit disconnected.");
            }
        }
    }
}

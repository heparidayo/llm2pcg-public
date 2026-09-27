using System;
using System.Collections.Generic;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;

namespace Llm2Pcg.Generators.Nature
{
    /// <summary>
    /// Shared deterministic heightfield, region cleanup, Poisson anchor/vegetation and MST/A* path pipeline.
    /// Biome adapters supply policy only; the original Forest generator remains an unchanged compatibility path.
    /// </summary>
    public sealed class NatureBiomeGeneratorCore
    {
        private const int TerrainStage = 1100;
        private const int WaterStage = 1110;
        private const int CleanupStage = 1120;
        private const int AnchorStage = 1130;
        private const int PathStage = 1140;
        private const int VegetationStage = 1150;

        public BiomeWorldData Generate(PCGRequest request, NatureBiomeDefinition definition)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));
            PCGValidationResult validation = PCGRequestValidator.Validate(request);
            if (!validation.IsValid) throw new ArgumentException(validation.Code + ": " + validation.Message, nameof(request));
            if (request.worldType != definition.WorldType || request.generatorVersion != definition.GeneratorVersion || request.biome != definition.Biome)
                throw new ArgumentException("Request does not match the selected Nature biome definition.", nameof(request));

            ForestGeneratorSettings source = request.generatorSettings.forest;
            NatureSettings settings = ResolveProfile(request.generationProfile, definition, source);
            // Zero is an explicit dry-swamp request, including profiles that add water.
            bool drySwamp = definition == NatureWorldTypes.Swamp && source.waterThreshold == 0;
            int width = request.mapWidth;
            int height = request.mapHeight;
            int count = width * height;
            BiomeTile[] tiles = new BiomeTile[count];
            float[] elevations = new float[count];
            float[] moisture = new float[count];
            int terrainSeed = PcgSeed.Stage(request.seed, TerrainStage + definition.StageOffset);
            int waterSeed = PcgSeed.Stage(request.seed, WaterStage + definition.StageOffset);

            for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                int index = y * width + x;
                float baseNoise = FractalValueNoise(terrainSeed, x, y, settings.NoiseOctaves, settings.ElevationFrequency);
                float detailNoise = FractalValueNoise(terrainSeed ^ 0x2F6E2B1, x, y, Math.Max(1, settings.NoiseOctaves - 1), settings.ElevationFrequency * 1.9f);
                moisture[index] = FractalValueNoise(waterSeed, x, y, Math.Max(2, settings.NoiseOctaves - 1), settings.ElevationFrequency * .72f);
                float shaped = ShapeTerrain(definition.TerrainStyle, baseNoise, detailNoise);
                elevations[index] = QuantizeHeight(shaped * settings.ElevationScale);
                tiles[index] = !drySwamp && IsWater(definition, request.generationProfile, moisture[index], baseNoise, settings.WaterThreshold) ? BiomeTile.Water : BiomeTile.Ground;
            }

            CleanupSmallRegions(tiles, width, height, 6, PcgSeed.Stage(request.seed, CleanupStage + definition.StageOffset));
            if (!drySwamp) EnsureRepresentativeWater(tiles, moisture, elevations, width, height, definition, request.generationProfile);
            LandformHeightModifier.Apply(request, tiles, elevations);
            RiverLayoutModifier.Apply(request, tiles, elevations);

            List<Int2> anchors = PoissonPoints(PcgSeed.Stage(request.seed, AnchorStage + definition.StageOffset), width, height, Math.Max(6, (int)Math.Round(settings.ClearingRadius)), tiles, 7, null);
            EnsureTwoAnchors(anchors, tiles, width, height);
            int clearingRadius = Math.Max(2, (int)Math.Round(settings.ClearingRadius * .28f));
            for (int i = 0; i < anchors.Count; i++) PaintDisk(tiles, width, height, anchors[i], clearingRadius, BiomeTile.Ground);

            List<Edge> mst = BuildMst(anchors);
            int pathSeed = PcgSeed.Stage(request.seed, PathStage + definition.StageOffset);
            for (int i = 0; i < mst.Count; i++)
            {
                List<Int2> path = FindCostPath(tiles, elevations, width, height, anchors[mst[i].A], anchors[mst[i].B], pathSeed + i);
                for (int p = 0; p < path.Count; p++) PaintDisk(tiles, width, height, path[p], 1, BiomeTile.Path);
            }

            // Clearings and legacy paths must never punch gaps through an explicit river.
            RiverLayoutModifier.Apply(request, tiles, elevations);
            int vegetationDistance = Math.Max(2, (int)Math.Round(settings.VegetationMinDistance));
            List<Int2> vegetation = PoissonPoints(PcgSeed.Stage(request.seed, VegetationStage + definition.StageOffset), width, height, vegetationDistance, tiles, settings.VegetationMaxCount, anchors);
            return new BiomeWorldData(definition.WorldType, definition.GeneratorVersion, width, height, request.seed, tiles, anchors[0], anchors[anchors.Count - 1], vegetation, elevations);
        }

        private static NatureSettings ResolveProfile(string profile, NatureBiomeDefinition definition, ForestGeneratorSettings source)
        {
            float water = source.waterThreshold;
            float vegetationDistance = source.vegetationMinDistance;
            float elevationScale = source.elevationScale;
            int vegetationCount = source.vegetationMaxCount;

            if (definition == NatureWorldTypes.Swamp)
            {
                if (profile == PCGRequest.OpenMarshProfile) { water = Math.Min(.72f, water + .08f); vegetationDistance *= 1.45f; vegetationCount = (int)Math.Round(vegetationCount * .72f); }
                else if (profile == PCGRequest.DenseBogProfile) { water = Math.Min(.68f, water + .025f); vegetationDistance = Math.Max(1.5f, vegetationDistance * .72f); }
            }
            else if (definition == NatureWorldTypes.Snowfield)
            {
                if (profile == PCGRequest.SparseTundraProfile) { vegetationDistance *= 1.6f; vegetationCount = (int)Math.Round(vegetationCount * .55f); elevationScale *= .82f; }
                else if (profile == PCGRequest.FrozenGroveProfile) { vegetationDistance = Math.Max(2f, vegetationDistance * .72f); water = Math.Min(.4f, water + .04f); }
            }
            else if (definition == NatureWorldTypes.Desert)
            {
                if (profile == PCGRequest.DuneSeaProfile) { water *= .25f; vegetationDistance *= 1.55f; vegetationCount = (int)Math.Round(vegetationCount * .45f); elevationScale *= 1.2f; }
                else if (profile == PCGRequest.OasisDesertProfile) { water = Math.Max(.14f, water); vegetationDistance = Math.Max(2f, vegetationDistance * .72f); vegetationCount = (int)Math.Round(vegetationCount * 1.35f); }
            }

            return new NatureSettings(water, source.noiseOctaves, source.clearingRadius, vegetationDistance, Math.Max(0, vegetationCount), elevationScale, source.elevationFrequency);
        }

        private static float ShapeTerrain(NatureTerrainStyle style, float value, float detail)
        {
            if (style == NatureTerrainStyle.Lowland) return .12f + .43f * Smooth(value) + .08f * detail;
            if (style == NatureTerrainStyle.Rolling) return .08f + .70f * value + .16f * detail;
            float ridge = 1f - Math.Abs(value * 2f - 1f);
            return .08f + .26f * value + .74f * ridge;
        }

        private static bool IsWater(NatureBiomeDefinition definition, string profile, float moisture, float terrain, float threshold)
        {
            if (definition == NatureWorldTypes.Swamp) return moisture < threshold || terrain < threshold * .82f;
            if (definition == NatureWorldTypes.Snowfield) return moisture < threshold * .78f && terrain < .55f;
            float desertThreshold = profile == PCGRequest.OasisDesertProfile ? threshold : threshold * .28f;
            return moisture < desertThreshold && terrain < .48f;
        }

        private static void EnsureRepresentativeWater(BiomeTile[] tiles, float[] moisture, float[] elevations, int width, int height, NatureBiomeDefinition definition, string profile)
        {
            bool required = definition != NatureWorldTypes.Desert || profile == PCGRequest.OasisDesertProfile;
            if (!required) return;
            for (int i = 0; i < tiles.Length; i++) if (tiles[i] == BiomeTile.Water) return;
            int best = 0;
            for (int i = 1; i < moisture.Length; i++) if (moisture[i] < moisture[best]) best = i;
            Int2 center = new Int2(best % width, best / width);
            PaintDisk(tiles, width, height, center, Math.Max(1, Math.Min(width, height) / 32), BiomeTile.Water);
            for (int y = Math.Max(0, center.Y - 2); y <= Math.Min(height - 1, center.Y + 2); y++)
            for (int x = Math.Max(0, center.X - 2); x <= Math.Min(width - 1, center.X + 2); x++)
                if (tiles[y * width + x] == BiomeTile.Water) elevations[y * width + x] = Math.Min(elevations[y * width + x], .25f);
        }

        private static void CleanupSmallRegions(BiomeTile[] tiles, int width, int height, int minimumSize, int stageSeed)
        {
            // stageSeed intentionally selects which tile class is normalized first while preserving a fixed traversal.
            BiomeTile first = (stageSeed & 1) == 0 ? BiomeTile.Water : BiomeTile.Ground;
            CleanupTileRegions(tiles, width, height, first, minimumSize);
            CleanupTileRegions(tiles, width, height, first == BiomeTile.Water ? BiomeTile.Ground : BiomeTile.Water, minimumSize);
        }

        private static void CleanupTileRegions(BiomeTile[] tiles, int width, int height, BiomeTile target, int minimumSize)
        {
            bool[] visited = new bool[tiles.Length];
            int[] queue = new int[tiles.Length];
            List<int> region = new List<int>();
            int[] dx = { 0, 1, 0, -1 };
            int[] dy = { -1, 0, 1, 0 };
            for (int start = 0; start < tiles.Length; start++)
            {
                if (visited[start] || tiles[start] != target) continue;
                region.Clear();
                int read = 0, write = 0;
                queue[write++] = start;
                visited[start] = true;
                while (read < write)
                {
                    int current = queue[read++];
                    region.Add(current);
                    int x = current % width, y = current / width;
                    for (int d = 0; d < 4; d++)
                    {
                        int nx = x + dx[d], ny = y + dy[d];
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                        int next = ny * width + nx;
                        if (!visited[next] && tiles[next] == target) { visited[next] = true; queue[write++] = next; }
                    }
                }
                if (region.Count >= minimumSize) continue;
                BiomeTile replacement = target == BiomeTile.Water ? BiomeTile.Ground : BiomeTile.Water;
                for (int i = 0; i < region.Count; i++) tiles[region[i]] = replacement;
            }
        }

        private static float FractalValueNoise(int seed, int x, int y, int octaves, float frequency)
        {
            float sum = 0f, amplitude = 1f, total = 0f;
            int scale = PcgSeed.NoiseScale(frequency);
            for (int octave = 0; octave < octaves; octave++)
            {
                sum += ValueNoise(seed + octave * 7919, x, y, scale) * amplitude;
                total += amplitude;
                amplitude *= .5f;
                scale = Math.Max(3, scale / 2);
            }
            return sum / total;
        }

        private static float ValueNoise(int seed, int x, int y, int scale)
        {
            int x0 = FloorDiv(x, scale), y0 = FloorDiv(y, scale);
            int localX = x - x0 * scale, localY = y - y0 * scale;
            float tx = Smooth(localX / (float)scale), ty = Smooth(localY / (float)scale);
            float a = Hash01(seed, x0, y0), b = Hash01(seed, x0 + 1, y0);
            float c = Hash01(seed, x0, y0 + 1), d = Hash01(seed, x0 + 1, y0 + 1);
            return Lerp(Lerp(a, b, tx), Lerp(c, d, tx), ty);
        }

        private static int FloorDiv(int value, int divisor) { int result = value / divisor; return value < 0 && value % divisor != 0 ? result - 1 : result; }
        private static float Hash01(int seed, int x, int y) { unchecked { uint n = (uint)(seed + x * 374761393 + y * 668265263); n = (n ^ (n >> 13)) * 1274126177u; n ^= n >> 16; return (n & 65535u) / 65535f; } }
        private static float Smooth(float value) => value * value * (3f - 2f * value);
        private static float Lerp(float a, float b, float t) => a + (b - a) * t;
        private static float QuantizeHeight(float value) => (float)Math.Round(value * 4f, MidpointRounding.AwayFromZero) * .25f;

        private static List<Int2> PoissonPoints(int seed, int width, int height, int minimumDistance, BiomeTile[] tiles, int maximum, List<Int2> exclusions)
        {
            PcgDeterministicRandom random = new PcgDeterministicRandom(seed);
            List<Int2> result = new List<Int2>();
            int marginX = Math.Min(2, Math.Max(0, (width - 1) / 2));
            int marginY = Math.Min(2, Math.Max(0, (height - 1) / 2));
            int spanX = Math.Max(1, width - marginX * 2);
            int spanY = Math.Max(1, height - marginY * 2);
            int attempts = Math.Max(64, width * height * 2);
            PcgPointSpacingIndex spacing = new PcgPointSpacingIndex(width, height, minimumDistance);
            for (int attempt = 0; attempt < attempts && result.Count < maximum; attempt++)
            {
                int x = marginX + random.NextInt(spanX), y = marginY + random.NextInt(spanY);
                if (tiles[y * width + x] != BiomeTile.Ground) continue;
                if (!spacing.CanPlace(x, y) || exclusions != null && TooClose(x, y, exclusions, 16)) continue;
                result.Add(new Int2(x, y));
                spacing.Add(x, y);
            }
            result.Sort((a, b) => (a.Y * width + a.X).CompareTo(b.Y * width + b.X));
            return result;
        }

        private static bool TooClose(int x, int y, List<Int2> points, int minimumSquared)
        {
            for (int i = 0; i < points.Count; i++) { int dx = x - points[i].X, dy = y - points[i].Y; if (dx * dx + dy * dy < minimumSquared) return true; }
            return false;
        }

        private static void EnsureTwoAnchors(List<Int2> anchors, BiomeTile[] tiles, int width, int height)
        {
            if (anchors.Count >= 2) return;
            anchors.Clear();
            Int2 first = FindNearestGround(tiles, width, height, new Int2(width / 4, height / 2));
            Int2 second = FindNearestGround(tiles, width, height, new Int2(3 * width / 4, height / 2));
            if (first.Equals(second)) second = FindNearestGround(tiles, width, height, new Int2(width / 2, Math.Max(0, height - 2)));
            anchors.Add(first);
            anchors.Add(second);
            PaintDisk(tiles, width, height, first, 2, BiomeTile.Ground);
            PaintDisk(tiles, width, height, second, 2, BiomeTile.Ground);
            anchors.Sort((a, b) => (a.Y * width + a.X).CompareTo(b.Y * width + b.X));
        }

        private static Int2 FindNearestGround(BiomeTile[] tiles, int width, int height, Int2 target)
        {
            int best = -1, bestDistance = int.MaxValue;
            for (int i = 0; i < tiles.Length; i++)
            {
                if (tiles[i] != BiomeTile.Ground) continue;
                int x = i % width, y = i / width;
                int distance = Math.Abs(x - target.X) + Math.Abs(y - target.Y);
                if (distance < bestDistance) { bestDistance = distance; best = i; }
            }
            if (best < 0) { best = Math.Max(0, Math.Min(tiles.Length - 1, target.Y * width + target.X)); tiles[best] = BiomeTile.Ground; }
            return new Int2(best % width, best / width);
        }

        private static List<Edge> BuildMst(List<Int2> points)
        {
            List<Edge> edges = new List<Edge>();
            for (int a = 0; a < points.Count; a++) for (int b = a + 1; b < points.Count; b++) edges.Add(new Edge(a, b, Math.Abs(points[a].X - points[b].X) + Math.Abs(points[a].Y - points[b].Y)));
            edges.Sort((left, right) => left.CompareTo(right));
            int[] parent = new int[points.Count]; for (int i = 0; i < parent.Length; i++) parent[i] = i;
            List<Edge> result = new List<Edge>();
            for (int i = 0; i < edges.Count && result.Count < points.Count - 1; i++) { Edge edge = edges[i]; if (Find(parent, edge.A) == Find(parent, edge.B)) continue; Union(parent, edge.A, edge.B); result.Add(edge); }
            return result;
        }

        private static List<Int2> FindCostPath(BiomeTile[] tiles, float[] elevations, int width, int height, Int2 start, Int2 end, int tieSeed)
        {
            int count = tiles.Length;
            int[] cost = new int[count], previous = new int[count];
            bool[] closed = new bool[count];
            for (int i = 0; i < count; i++) { cost[i] = int.MaxValue; previous[i] = -1; }
            int startIndex = start.Y * width + start.X, endIndex = end.Y * width + end.X;
            cost[startIndex] = 0;
            MinHeap open = new MinHeap();
            open.Push(new PathNode(startIndex, Heuristic(start, end), StableTie(tieSeed, startIndex)));
            int[] dx = { 0, 1, 0, -1 }, dy = { -1, 0, 1, 0 };
            while (open.Count > 0)
            {
                PathNode node = open.Pop(); if (closed[node.Index]) continue;
                closed[node.Index] = true; if (node.Index == endIndex) break;
                int x = node.Index % width, y = node.Index / width;
                for (int direction = 0; direction < 4; direction++)
                {
                    int nx = x + dx[direction], ny = y + dy[direction]; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    int next = ny * width + nx;
                    int waterCost = tiles[next] == BiomeTile.Water ? 8 : 1;
                    int slopeCost = (int)Math.Round(Math.Abs(elevations[next] - elevations[node.Index]) * 4f);
                    int candidate = cost[node.Index] + waterCost + slopeCost;
                    if (candidate >= cost[next]) continue;
                    cost[next] = candidate; previous[next] = node.Index;
                    open.Push(new PathNode(next, candidate + Math.Abs(nx - end.X) + Math.Abs(ny - end.Y), StableTie(tieSeed, next)));
                }
            }
            List<Int2> path = new List<Int2>();
            for (int at = endIndex; at >= 0; at = previous[at]) { path.Add(new Int2(at % width, at / width)); if (at == startIndex) break; }
            path.Reverse();
            return path;
        }

        private static int StableTie(int seed, int index) { unchecked { uint value = (uint)(seed ^ index * 0x45D9F3B); value ^= value >> 16; return (int)(value & 0x7FFFFFFF); } }
        private static int Heuristic(Int2 a, Int2 b) => Math.Abs(a.X - b.X) + Math.Abs(a.Y - b.Y);
        private static void PaintDisk(BiomeTile[] tiles, int width, int height, Int2 center, int radius, BiomeTile tile) { for (int y = center.Y - radius; y <= center.Y + radius; y++) for (int x = center.X - radius; x <= center.X + radius; x++) if (x >= 0 && y >= 0 && x < width && y < height && (x - center.X) * (x - center.X) + (y - center.Y) * (y - center.Y) <= radius * radius) tiles[y * width + x] = tile; }
        private static int Find(int[] parent, int value) { while (parent[value] != value) { parent[value] = parent[parent[value]]; value = parent[value]; } return value; }
        private static void Union(int[] parent, int a, int b) { a = Find(parent, a); b = Find(parent, b); if (a != b) parent[b] = a; }

        private readonly struct NatureSettings
        {
            public readonly float WaterThreshold; public readonly int NoiseOctaves; public readonly float ClearingRadius; public readonly float VegetationMinDistance; public readonly int VegetationMaxCount; public readonly float ElevationScale; public readonly float ElevationFrequency;
            public NatureSettings(float waterThreshold, int noiseOctaves, float clearingRadius, float vegetationMinDistance, int vegetationMaxCount, float elevationScale, float elevationFrequency) { WaterThreshold=waterThreshold; NoiseOctaves=noiseOctaves; ClearingRadius=clearingRadius; VegetationMinDistance=vegetationMinDistance; VegetationMaxCount=vegetationMaxCount; ElevationScale=elevationScale; ElevationFrequency=elevationFrequency; }
        }
        private readonly struct Edge : IComparable<Edge> { public readonly int A, B, Cost; public Edge(int a, int b, int cost) { A=a; B=b; Cost=cost; } public int CompareTo(Edge other) { int c=Cost.CompareTo(other.Cost); if(c!=0)return c; c=A.CompareTo(other.A); return c!=0?c:B.CompareTo(other.B); } }
        private readonly struct PathNode : IComparable<PathNode> { public readonly int Index, Score, Tie; public PathNode(int index,int score,int tie){Index=index;Score=score;Tie=tie;} public int CompareTo(PathNode other){int c=Score.CompareTo(other.Score);if(c!=0)return c;c=Tie.CompareTo(other.Tie);return c!=0?c:Index.CompareTo(other.Index);} }
        private sealed class MinHeap { private readonly List<PathNode> values=new List<PathNode>(); public int Count=>values.Count; public void Push(PathNode value){values.Add(value);int i=values.Count-1;while(i>0){int p=(i-1)/2;if(values[p].CompareTo(value)<=0)break;values[i]=values[p];i=p;}values[i]=value;} public PathNode Pop(){PathNode root=values[0],last=values[values.Count-1];values.RemoveAt(values.Count-1);if(values.Count==0)return root;int i=0;while(true){int left=i*2+1;if(left>=values.Count)break;int right=left+1,child=right<values.Count&&values[right].CompareTo(values[left])<0?right:left;if(values[child].CompareTo(last)>=0)break;values[i]=values[child];i=child;}values[i]=last;return root;} }
    }
}

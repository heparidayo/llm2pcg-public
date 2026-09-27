using System;
using System.Collections.Generic;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;

namespace Llm2Pcg.Generators.Forest
{
    /// <summary>Continuous deterministic value-noise terrain, Poisson clearings/vegetation and cost-field A* MST paths.</summary>
    public sealed class ForestBiomeGenerator : IPCGGenerator
    {
        public string WorldType => PCGRequest.ForestWorldType;
        public string GeneratorVersion => PCGRequest.ForestGeneratorVersion;
        public IPCGWorldData Generate(PCGRequest request) => GenerateForest(request);

        public BiomeWorldData GenerateForest(PCGRequest request)
        {
            PCGValidationResult validation = PCGRequestValidator.Validate(request);
            if (!validation.IsValid) throw new ArgumentException(validation.Code + ": " + validation.Message, nameof(request));

            ForestGeneratorSettings settings = request.generatorSettings.forest;
            float waterThreshold = settings.waterThreshold;
            float vegetationDistance = settings.vegetationMinDistance;
            if (request.generationProfile == PCGRequest.DenseForestProfile) vegetationDistance = Math.Max(1.5f, vegetationDistance * .72f);
            if (request.generationProfile == PCGRequest.MeadowForestProfile) { vegetationDistance *= 1.45f; waterThreshold *= .82f; }

            int width = request.mapWidth;
            int height = request.mapHeight;
            BiomeTile[] tiles = new BiomeTile[width * height];
            float[] elevations = new float[width * height];
            int terrainSeed = PcgSeed.Stage(request.seed, 200);
            for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                int index = y * width + x;
                float terrain = FractalValueNoise(terrainSeed, x, y, settings.noiseOctaves, settings.elevationFrequency);
                tiles[index] = terrain < waterThreshold ? BiomeTile.Water : BiomeTile.Ground;
                elevations[index] = QuantizeHeight(Math.Max(0f, terrain - waterThreshold) * settings.elevationScale);
            }

            Llm2Pcg.Generators.Nature.LandformHeightModifier.Apply(request, tiles, elevations);
            Llm2Pcg.Generators.Nature.RiverLayoutModifier.Apply(request, tiles, elevations);
            bool hasLandform = request.layoutSettings.landform.kind == SpatialLayoutValues.Mountain;
            List<Int2> clearings = PoissonPoints(PcgSeed.Stage(request.seed, 220), width, height, Math.Max(6, (int)settings.clearingRadius), tiles, 7);
            EnsureTwoClearings(clearings, tiles, width, height);
            int clearingRadius = Math.Max(2, (int)(settings.clearingRadius * .28f));
            for (int i = 0; i < clearings.Count; i++) PaintDisk(tiles, width, height, clearings[i], clearingRadius, BiomeTile.Ground);

            List<Edge> tree = BuildMst(clearings);
            for (int i = 0; i < tree.Count; i++)
            {
                List<Int2> path = FindCostPath(tiles, width, height, clearings[tree[i].A], clearings[tree[i].B], hasLandform ? elevations : null);
                for (int p = 0; p < path.Count; p++) PaintDisk(tiles, width, height, path[p], 1, BiomeTile.Path);
            }

            Llm2Pcg.Generators.Nature.RiverLayoutModifier.Apply(request, tiles, elevations);
            List<Int2> vegetation = PoissonPoints(PcgSeed.Stage(request.seed, 240), width, height, Math.Max(2, (int)vegetationDistance), tiles, settings.vegetationMaxCount);
            return new BiomeWorldData(WorldType, GeneratorVersion, width, height, request.seed, tiles, clearings[0], clearings[clearings.Count - 1], vegetation, elevations);
        }

        private static float FractalValueNoise(int seed, int x, int y, int octaves, float frequency)
        {
            float sum = 0f, amplitude = 1f, total = 0f;
            int scale = PcgSeed.NoiseScale(frequency);
            for (int octave = 0; octave < octaves; octave++)
            {
                sum += ValueNoise(seed + octave * 7919, x, y, Math.Max(3, scale)) * amplitude;
                total += amplitude;
                amplitude *= .5f;
                scale = Math.Max(3, scale / 2);
            }
            return sum / total;
        }

        private static float ValueNoise(int seed, int x, int y, int scale)
        {
            int x0 = x / scale, y0 = y / scale;
            float tx = Smooth((x % scale) / (float)scale), ty = Smooth((y % scale) / (float)scale);
            float a = Hash01(seed, x0, y0), b = Hash01(seed, x0 + 1, y0);
            float c = Hash01(seed, x0, y0 + 1), d = Hash01(seed, x0 + 1, y0 + 1);
            return Lerp(Lerp(a, b, tx), Lerp(c, d, tx), ty);
        }

        private static float Hash01(int seed, int x, int y) { unchecked { uint n = (uint)(seed + x * 374761393 + y * 668265263); n = (n ^ (n >> 13)) * 1274126177u; n ^= n >> 16; return (n & 65535u) / 65535f; } }
        private static float Smooth(float value) => value * value * (3f - 2f * value);
        private static float Lerp(float a, float b, float t) => a + (b - a) * t;
        private static float QuantizeHeight(float value) => (float)Math.Round(value * 4f, MidpointRounding.AwayFromZero) * .25f;

        private static List<Int2> PoissonPoints(int seed, int width, int height, int minimumDistance, BiomeTile[] tiles, int maximum)
        {
            PcgDeterministicRandom random = new PcgDeterministicRandom(seed);
            List<Int2> result = new List<Int2>();
            int attempts = Math.Max(64, width * height * 2);
            PcgPointSpacingIndex spacing = new PcgPointSpacingIndex(width, height, minimumDistance);
            for (int attempt = 0; attempt < attempts && result.Count < maximum; attempt++)
            {
                int x = 2 + random.NextInt(Math.Max(1, width - 4));
                int y = 2 + random.NextInt(Math.Max(1, height - 4));
                BiomeTile tile = tiles[y * width + x];
                if (tile != BiomeTile.Ground || !spacing.CanPlace(x, y)) continue;
                result.Add(new Int2(x, y));
                spacing.Add(x, y);
            }
            result.Sort((a, b) => (a.Y * width + a.X).CompareTo(b.Y * width + b.X));
            return result;
        }

        private static void EnsureTwoClearings(List<Int2> clearings, BiomeTile[] tiles, int width, int height)
        {
            if (clearings.Count >= 2) return;
            clearings.Clear();
            clearings.Add(new Int2(width / 4, height / 2));
            clearings.Add(new Int2(3 * width / 4, height / 2));
            tiles[(height / 2) * width + width / 4] = BiomeTile.Ground;
            tiles[(height / 2) * width + 3 * width / 4] = BiomeTile.Ground;
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

        private static List<Int2> FindCostPath(BiomeTile[] tiles, int width, int height, Int2 start, Int2 end, float[] elevations)
        {
            int count = tiles.Length; int[] cost = new int[count], previous = new int[count]; bool[] closed = new bool[count];
            for (int i = 0; i < count; i++) { cost[i] = int.MaxValue; previous[i] = -1; }
            int startIndex = start.Y * width + start.X, endIndex = end.Y * width + end.X; cost[startIndex] = 0;
            MinHeap open = new MinHeap(); open.Push(new PathNode(startIndex, Heuristic(start, end)));
            int[] dx = { 0, 1, 0, -1 }, dy = { -1, 0, 1, 0 };
            while (open.Count > 0)
            {
                PathNode node = open.Pop(); if (closed[node.Index]) continue; closed[node.Index] = true; if (node.Index == endIndex) break;
                int x = node.Index % width, y = node.Index / width;
                for (int direction = 0; direction < 4; direction++)
                {
                    int nx = x + dx[direction], ny = y + dy[direction]; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    int next = ny * width + nx; int step = tiles[next] == BiomeTile.Water ? 9 : 1;
                    if (elevations != null) step += (int)(Math.Abs(elevations[next] - elevations[node.Index]) * 4f);
                    int candidate = cost[node.Index] + step;
                    if (candidate >= cost[next]) continue; cost[next] = candidate; previous[next] = node.Index; open.Push(new PathNode(next, candidate + Math.Abs(nx - end.X) + Math.Abs(ny - end.Y)));
                }
            }
            List<Int2> path = new List<Int2>(); for (int at = endIndex; at >= 0; at = previous[at]) { path.Add(new Int2(at % width, at / width)); if (at == startIndex) break; }
            path.Reverse(); return path;
        }

        private static int Heuristic(Int2 a, Int2 b) => Math.Abs(a.X - b.X) + Math.Abs(a.Y - b.Y);
        private static void PaintDisk(BiomeTile[] tiles, int width, int height, Int2 center, int radius, BiomeTile tile) { for (int y = center.Y - radius; y <= center.Y + radius; y++) for (int x = center.X - radius; x <= center.X + radius; x++) if (x >= 0 && y >= 0 && x < width && y < height && (x - center.X) * (x - center.X) + (y - center.Y) * (y - center.Y) <= radius * radius) tiles[y * width + x] = tile; }
        private static int Find(int[] parent, int value) { while (parent[value] != value) { parent[value] = parent[parent[value]]; value = parent[value]; } return value; }
        private static void Union(int[] parent, int a, int b) { a = Find(parent, a); b = Find(parent, b); if (a != b) parent[b] = a; }

        private readonly struct Edge : IComparable<Edge> { public readonly int A, B, Cost; public Edge(int a, int b, int cost) { A = a; B = b; Cost = cost; } public int CompareTo(Edge other) { int c = Cost.CompareTo(other.Cost); if (c != 0) return c; c = A.CompareTo(other.A); return c != 0 ? c : B.CompareTo(other.B); } }
        private readonly struct PathNode : IComparable<PathNode> { public readonly int Index, Score; public PathNode(int index, int score) { Index = index; Score = score; } public int CompareTo(PathNode other) { int c = Score.CompareTo(other.Score); return c != 0 ? c : Index.CompareTo(other.Index); } }
        private sealed class MinHeap { private readonly List<PathNode> values = new List<PathNode>(); public int Count => values.Count; public void Push(PathNode value) { values.Add(value); int i = values.Count - 1; while (i > 0) { int p = (i - 1) / 2; if (values[p].CompareTo(value) <= 0) break; values[i] = values[p]; i = p; } values[i] = value; } public PathNode Pop() { PathNode root = values[0], last = values[values.Count - 1]; values.RemoveAt(values.Count - 1); if (values.Count == 0) return root; int i = 0; while (true) { int left = i * 2 + 1; if (left >= values.Count) break; int right = left + 1, child = right < values.Count && values[right].CompareTo(values[left]) < 0 ? right : left; if (values[child].CompareTo(last) >= 0) break; values[i] = values[child]; i = child; } values[i] = last; return root; } }
    }
}

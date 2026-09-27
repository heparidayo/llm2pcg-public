using System;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;

namespace Llm2Pcg.Generators.Nature
{
    /// <summary>Opt-in landform shaping before anchors, paths and vegetation. Neutral requests remain byte-identical.</summary>
    public static class LandformHeightModifier
    {
        public static void Apply(PCGRequest request, BiomeTile[] tiles, float[] elevations)
        {
            LandformLayoutSettings land = request.layoutSettings?.landform;
            if (land == null || land.kind != SpatialLayoutValues.Mountain) return;

            int width = request.mapWidth, height = request.mapHeight;
            int span = Math.Min(width, height);
            int percent = land.size == "Small" ? 14 : land.size == "Large" ? 34 : 23;
            int radius = Math.Max(2, span * percent / 100);
            int cx = width / 2, cy = height / 2;
            // Cardinal centers stay in the requested half even when a large footprint reaches the boundary.
            if (land.placement == "North") cy = height * 3 / 4;
            if (land.placement == "South") cy = height / 4;
            if (land.placement == "East") cx = width * 3 / 4;
            if (land.placement == "West") cx = width / 4;
            if (land.placement == "Seeded")
            {
                PcgDeterministicRandom random = new PcgDeterministicRandom(PcgSeed.Stage(request.seed, 1280));
                cx = radius + random.NextInt(Math.Max(1, width - radius * 2));
                cy = radius + random.NextInt(Math.Max(1, height - radius * 2));
            }

            int baselineMaxUnits = 0;
            for (int i = 0; i < elevations.Length; i++) baselineMaxUnits = Math.Max(baselineMaxUnits, (int)(elevations[i] * 4f));
            int risePercent = land.intensity == "Low" ? 18 : land.intensity == "High" ? 62 : 38;
            int summitUnits = baselineMaxUnits + Math.Max(4, radius * risePercent * 4 / 100);
            long radiusSquared = radius * radius;
            for (int y = Math.Max(0, cy - radius); y <= Math.Min(height - 1, cy + radius); y++)
            for (int x = Math.Max(0, cx - radius); x <= Math.Min(width - 1, cx + radius); x++)
            {
                long distanceSquared = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                if (distanceSquared >= radiusSquared) continue;
                // Squared radial falloff has a smooth toe and summit; integer arithmetic matches Unity/.NET.
                long remaining = radiusSquared - distanceSquared;
                long weight = 4096L * remaining * remaining / (radiusSquared * radiusSquared);
                int index = y * width + x;
                long baseUnits = (int)(elevations[index] * 4f);
                elevations[index] = ((baseUnits * (4096 - weight) + summitUnits * weight + 2048) / 4096) * .25f;
                // Raised land is dry; otherwise the surface renderer would cut a sea-level hole in the mountain.
                tiles[index] = BiomeTile.Ground;
            }
        }
    }
}

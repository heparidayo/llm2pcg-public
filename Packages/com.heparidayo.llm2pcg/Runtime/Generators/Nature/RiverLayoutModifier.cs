using System;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;

namespace Llm2Pcg.Generators.Nature
{
    /// <summary>Deterministic central river. Default requests retain their existing world bytes.</summary>
    public static class RiverLayoutModifier
    {
        public static void Apply(PCGRequest request, BiomeTile[] tiles, float[] elevations)
        {
            WaterLayoutSettings water = request.layoutSettings?.water;
            if (water == null || water.kind != SpatialLayoutValues.River) return;
            int width = request.mapWidth, height = request.mapHeight;
            bool northSouth = water.placement == "CenterNorthSouth";
            int span = northSouth ? width : height;
            int percent = water.size == "Small" ? 3 : water.size == "Large" ? 9 : 5;
            int halfWidth = Math.Max(1, span * percent / 200);
            int center = span / 2;
            for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                int index = y * width + x;
                if (Math.Abs((northSouth ? x : y) - center) <= halfWidth)
                {
                    tiles[index] = BiomeTile.Water;
                    elevations[index] = 0f;
                }
                else if (water.exclusive && tiles[index] == BiomeTile.Water)
                    tiles[index] = BiomeTile.Ground;
            }
        }
    }
}

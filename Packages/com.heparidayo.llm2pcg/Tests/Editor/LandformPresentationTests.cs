using System.Collections.Generic;
using Llm2Pcg.Contract;
using Llm2Pcg.Core;
using Llm2Pcg.Presentation;
using Llm2Pcg.Rendering;
using NUnit.Framework;
using UnityEngine;

namespace Llm2Pcg.Tests.EditMode
{
    public sealed class LandformPresentationTests
    {
        [Test]
        public void MountainSurfaceAndFirstPersonUseTheSameRaisedHeights()
        {
            PCGRequest request=PCGRequest.CreateForestDefault(234,128,128);
            request.layoutSettings.landform=new LandformLayoutSettings {kind="Mountain",placement="Center",size="Large",intensity="High"};
            var world=(BiomeWorldData)PCGGeneratorRegistry.Default.GetRequired(request).Generate(request);
            var mesh=ForestSurfaceMeshBuilder.BuildData(world);
            float summit=world.GetSurfaceHeight(64,64);
            Assert.That(ForestSurfaceMeshBuilder.SampleSurfaceHeight(world,64,64),Is.EqualTo(summit));
            Assert.That(mesh.Vertices[(64*2+1)*mesh.GridWidth+64*2+1].y,Is.EqualTo(summit));
            Assert.That(PCGFirstPersonTestDummy.CanOccupy(world,new Vector3(64,summit,64),summit,.28f,1.25f),Is.True);
            Assert.That(PCGFirstPersonTestDummy.CanOccupy(world,new Vector3(64,0,64),0,.28f,1.25f),Is.False);

            // Reachability includes the controller's step limit, not just a walkable tile flag.
            var seen=new HashSet<int>();var queue=new Queue<Int2>();queue.Enqueue(world.StartPosition);
            seen.Add(world.StartPosition.Y*world.Width+world.StartPosition.X);
            int[] dx={0,1,0,-1},dy={-1,0,1,0};
            while(queue.Count>0)
            {
                Int2 p=queue.Dequeue();
                for(int d=0;d<4;d++)
                {
                    int x=p.X+dx[d],y=p.Y+dy[d],index=y*world.Width+x;
                    if(!world.IsInBounds(x,y)||seen.Contains(index))continue;
                    float h=world.GetSurfaceHeight(p.X,p.Y);
                    if(!PCGFirstPersonTestDummy.CanOccupy(world,new Vector3(x,h,y),h,.28f,1.25f))continue;
                    seen.Add(index);queue.Enqueue(new Int2(x,y));
                }
            }
            Assert.That(seen.Contains(world.ExitPosition.Y*world.Width+world.ExitPosition.X),Is.True,"Exit must remain reachable over the shaped terrain.");
            Assert.That(seen.Contains(64*world.Width+64),Is.True,"The summit must be reachable from spawn.");
        }
    }
}

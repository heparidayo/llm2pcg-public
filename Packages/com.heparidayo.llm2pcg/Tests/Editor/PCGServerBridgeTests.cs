using Llm2Pcg.Bridge;
using NUnit.Framework;
using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using Llm2Pcg.Contract;
using UnityEngine;
using UnityEngine.TestTools;

namespace Llm2Pcg.Tests.EditMode
{
    public sealed class PCGServerBridgeTests
    {
        private static readonly string[] AllowedOrigins =
        {
            "http://127.0.0.1:3000",
            "http://localhost:3000"
        };

        [TestCase(null)]
        [TestCase("")]
        [TestCase("http://127.0.0.1:3000")]
        [TestCase("http://localhost:3000/")]
        public void LocalOrServerOrigin_IsAllowed(string origin)
        {
            Assert.That(PCGServerBridge.IsOriginAllowed(origin, AllowedOrigins), Is.True);
        }

        [TestCase("http://example.com")]
        [TestCase("http://localhost:8080")]
        [TestCase("https://localhost:3000")]
        public void UnlistedBrowserOrigin_IsRejected(string origin)
        {
            Assert.That(PCGServerBridge.IsOriginAllowed(origin, AllowedOrigins), Is.False);
        }

        private static int FreePort()
        {
            var socket = new TcpListener(IPAddress.Loopback, 0);
            socket.Start();
            int port = ((IPEndPoint)socket.LocalEndpoint).Port;
            socket.Stop();
            return port;
        }

        private static void AssertPortReleased(int port)
        {
            var socket = new TcpListener(IPAddress.Loopback, port);
            try { socket.Start(); }
            finally { socket.Stop(); }
        }

        private static HttpStatusCode Post(int port, string body)
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/pcg/generate");
            request.Method = "POST";
            request.ContentType = "application/json";
            request.Timeout = 3000;
            byte[] bytes = Encoding.UTF8.GetBytes(body);
            request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            using (var response = (HttpWebResponse)request.GetResponse()) return response.StatusCode;
        }

        private static HttpStatusCode PostDiagnostic(int port, string message)
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/pcg/diagnostics");
            request.Method = "POST";
            request.ContentLength = 0;
            request.Timeout = 3000;
            request.Headers["X-PCG-Diagnostics"] = message;
            try { using (var response = (HttpWebResponse)request.GetResponse()) return response.StatusCode; }
            catch (WebException error) when (error.Response is HttpWebResponse)
            { using (var response = (HttpWebResponse)error.Response) return response.StatusCode; }
        }

        [Test]
        public void Diagnostics_LogOnMainThreadWithoutChangingHudOrGeneratingMaps()
        {
            var host = new GameObject("Bridge diagnostic test");
            var bridge = host.AddComponent<PCGServerBridge>();
            int port = FreePort();
            bridge.ConfigureForLocalDemo(port);
            const string message = "[PCG Interpretation] Interpretation was incomplete; generation will continue with defaults.";
            try
            {
                LogAssert.Expect(LogType.Log, "PCG HTTP bridge listening on port " + port + ".");
                Assert.That(bridge.StartServer(), Is.True);
                string previousCode = bridge.LastResponseCode;
                Assert.That(PostDiagnostic(port, message), Is.EqualTo(HttpStatusCode.NoContent));
                Assert.That(bridge.LastResponseCode, Is.EqualTo(previousCode));
                Assert.That(bridge.PendingRequestCount, Is.Zero);
                LogAssert.Expect(LogType.Warning, message);
                typeof(PCGServerBridge).GetMethod("Update", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(bridge, null);
                Assert.That(PostDiagnostic(port, message), Is.EqualTo(HttpStatusCode.NoContent));
                bridge.StopServer();
                typeof(PCGServerBridge).GetMethod("Update", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(bridge, null); // Stop discards undelivered diagnostics.
                LogAssert.NoUnexpectedReceived();
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }

        [Test]
        public void Diagnostics_RejectOversizedMessagesWithoutChangingHud()
        {
            var host = new GameObject("Bridge diagnostic size test");
            var bridge = host.AddComponent<PCGServerBridge>();
            int port = FreePort();
            bridge.ConfigureForLocalDemo(port);
            try
            {
                Assert.That(bridge.StartServer(), Is.True);
                string previousCode = bridge.LastResponseCode;
                Assert.That(PostDiagnostic(port, new string('a', 2049)), Is.EqualTo(HttpStatusCode.BadRequest));
                Assert.That(bridge.LastResponseCode, Is.EqualTo(previousCode));
                Assert.That(bridge.PendingRequestCount, Is.Zero);
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }

        [Test]
        public void RepeatedStartStop_ReleasesPortAndClearsOldRequests()
        {
            var host = new GameObject("Bridge lifecycle test");
            var bridge = host.AddComponent<PCGServerBridge>();
            int port = FreePort();
            bridge.ConfigureForLocalDemo(port);
            try
            {
                for (int cycle = 0; cycle < 5; cycle++)
                {
                    Assert.That(bridge.StartServer(), Is.True, bridge.LastServerError);
                    Assert.That(bridge.StartServer(), Is.True);
                    Assert.That(Post(port, JsonUtility.ToJson(PCGRequest.CreateForestDefault())), Is.EqualTo(HttpStatusCode.Accepted));
                    Assert.That(bridge.PendingRequestCount, Is.EqualTo(1));
                    bridge.StopServer();
                    bridge.StopServer();
                    Assert.That(bridge.IsRunning, Is.False);
                    Assert.That(bridge.PendingRequestCount, Is.Zero);
                    Assert.That(bridge.LastServerError, Is.Null);
                    AssertPortReleased(port);
                }
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }

        [Test]
        public void PartialStartFailure_ReleasesEarlierPrefixesAndAllowsRetry()
        {
            if (!Socket.OSSupportsIPv6) Assert.Ignore("IPv6 localhost required for partial-prefix collision test.");
            int port = FreePort();
            var occupied = new TcpListener(IPAddress.IPv6Loopback, port);
            var host = new GameObject("Bridge failed start test");
            var bridge = host.AddComponent<PCGServerBridge>();
            bridge.ConfigureForLocalDemo(port);
            try
            {
                occupied.Start();
                LogAssert.Expect(LogType.Error, new Regex("PCG HTTP bridge could not start on port " + port));
                Assert.That(bridge.StartServer(), Is.False);
                Assert.That(bridge.IsRunning, Is.False);
                AssertPortReleased(port);
                occupied.Stop();
                Assert.That(bridge.StartServer(), Is.True, bridge.LastServerError);
                bridge.StopServer();
                AssertPortReleased(port);
            }
            finally { occupied.Stop(); UnityEngine.Object.DestroyImmediate(host); }
        }

        [Test]
        public void StopDuringIncompleteBody_ReleasesPortAndWorker()
        {
            var host = new GameObject("Bridge pending body test");
            var bridge = host.AddComponent<PCGServerBridge>();
            int port = FreePort();
            bridge.ConfigureForLocalDemo(port);
            try
            {
                Assert.That(bridge.StartServer(), Is.True);
                using (var client = new TcpClient())
                {
                    client.Connect(IPAddress.Loopback, port);
                    byte[] partial = Encoding.ASCII.GetBytes("POST /pcg/generate HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nContent-Length: 1000\r\n\r\n{");
                    client.GetStream().Write(partial, 0, partial.Length);
                    Thread.Sleep(100);
                    bridge.StopServer();
                    Assert.That(bridge.LastServerError, Is.Null);
                    AssertPortReleased(port);
                }
                Assert.That(bridge.StartServer(), Is.True);
                Assert.That(Post(port, JsonUtility.ToJson(PCGRequest.CreateForestDefault())), Is.EqualTo(HttpStatusCode.Accepted));
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }

        [Test]
        public void EditorTransitionHook_StopsListenerBeforeDomainTeardown()
        {
            var host = new GameObject("Bridge transition test");
            var bridge = host.AddComponent<PCGServerBridge>();
            int port = FreePort();
            bridge.ConfigureForLocalDemo(port);
            try
            {
                Assert.That(bridge.StartServer(), Is.True);
                typeof(PCGServerBridge).GetMethod("OnPlayModeChanged", BindingFlags.NonPublic | BindingFlags.Instance)
                    .Invoke(bridge, new object[] { UnityEditor.PlayModeStateChange.ExitingPlayMode });
                Assert.That(bridge.IsRunning, Is.False);
                AssertPortReleased(port);
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }
    }
}

#!/usr/bin/env bash
# Builds native/web-bridge (net48, needs the .NET SDK; reference assemblies come from NuGet,
# so it also compiles on Linux and macOS). Output: native/web-bridge/bin/Release/net48/web-bridge.exe
set -euo pipefail
cd "$(dirname "$0")/../native/web-bridge"
dotnet build WebBridge.csproj -c Release --nologo
echo "built: $(pwd)/bin/Release/net48/web-bridge.exe"

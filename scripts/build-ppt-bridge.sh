#!/usr/bin/env bash
# Builds native/ppt-bridge (net48, needs the .NET SDK; reference assemblies come from NuGet,
# so it also compiles on Linux and macOS). Output: native/ppt-bridge/bin/Release/net48/ppt-bridge.exe
set -euo pipefail
cd "$(dirname "$0")/../native/ppt-bridge"
dotnet build PptBridge.csproj -c Release --nologo
echo "built: $(pwd)/bin/Release/net48/ppt-bridge.exe"

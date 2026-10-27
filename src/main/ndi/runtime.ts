import { join } from 'path'

/** NDI runtime library file name for a platform. The runtime is never bundled. */
export function ndiLibraryName(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Processing.NDI.Lib.x64.dll'
  return 'libndi.so.6'
}

/** Ordered folders to look for the NDI runtime in. Pure: all inputs are passed in. */
export function ndiSearchDirs(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  programFiles: string
): string[] {
  const dirs: string[] = []
  for (const k of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5']) {
    if (env[k]) dirs.push(env[k] as string)
  }
  if (platform === 'win32') {
    const root = join(programFiles, 'NDI')
    dirs.push(
      join(root, 'NDI 6 Runtime', 'v6'),
      join(root, 'NDI 6 Tools', 'Runtime'),
      join(root, 'NDI 5 Runtime'),
      join(root, 'NDI 5 Tools', 'Runtime')
    )
  } else if (platform === 'linux') {
    dirs.push('/usr/lib', '/usr/local/lib', '/usr/lib/x86_64-linux-gnu')
  }
  return dirs
}

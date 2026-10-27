import { join } from 'path'
import { app } from 'electron'

/** Directory holding libomt and libvmx (side by side). Main process only: reads electron's app. */
export function libomtDir(): string {
  if (!app.isPackaged && process.env.PPT_LIBOMT_DIR) return process.env.PPT_LIBOMT_DIR
  return join(process.resourcesPath, 'omt')
}

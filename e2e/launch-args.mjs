// Chromium flags every e2e launch needs. On Linux the app relaunches itself on X11 when it
// starts in a Wayland session (hidden web pages paint on X11 only); that relaunch drops
// Playwright's connection (`<ws disconnected>`), so the flag is given up front.
export const linuxArgs = process.platform === 'linux' ? ['--ozone-platform=x11'] : []

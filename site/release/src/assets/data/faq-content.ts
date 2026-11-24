export const faqItems = [
  {
    question: 'Which file do I download?',
    answer:
      'On Windows, the installer (.exe). On a Mac, the Apple silicon disk for M1 and newer, or the Intel disk for older Macs (Apple menu > About This Mac shows the chip). On Linux, the AppImage runs on most distributions; the .deb is for Debian and Ubuntu.'
  },
  {
    question: 'How do I update?',
    answer:
      'The Windows app and the Linux AppImage check for updates and install them. The Mac app and the .deb do not: download the new version from this page and install it over the old one. Your events and decks stay.'
  },
  {
    question: 'macOS says the app cannot be opened. What now?',
    answer:
      'The Mac build is not signed with an Apple certificate yet. Right-click Bridgecast in Applications and choose Open, then Open again. If macOS still refuses, run xattr -cr /Applications/Bridgecast.app in Terminal.'
  },
  {
    question: 'Does it need PowerPoint?',
    answer:
      'For PowerPoint files, yes on Windows: Bridgecast imports them through PowerPoint and can play them as a real slide show, with animations and sound. On Linux it uses LibreOffice Impress with python3-uno instead. On a Mac, Bridgecast converts PowerPoint files to PDF with Keynote (free from the App Store) or LibreOffice when you import them, and plays them as sharp still slides without animations; macOS asks once to let Bridgecast control Keynote. PDF and video decks need nothing else on any system.'
  }
]

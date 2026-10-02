import type { CapacitorConfig } from '@capacitor/cli'

// Native shells (App Store / Play Store) wrap the same built web app.
// See docs/NATIVE.md for the one-time `npx cap add ios|android` steps.
const config: CapacitorConfig = {
  appId: 'com.albanna.bimplanner',
  appName: 'BIM Planner',
  webDir: 'dist',
  server: { androidScheme: 'https' },
}

export default config

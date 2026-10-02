# Native app shells (optional)

The installable web app already covers iPad, Android and Windows. Wrap the same build with Capacitor only if you want the app in the App Store or Play Store, or need to distribute it through MDM.

## Prerequisites

- iOS: a Mac with Xcode 15+ and an Apple Developer account.
- Android: Android Studio with SDK 34+.

## One-time

```bash
npm install
npm run build
npx cap add ios        # creates ios/
npx cap add android    # creates android/
```

`capacitor.config.ts` already points at `dist/` with app id `com.albanna.bimplanner`.

## Each release

```bash
npm run build
npx cap sync
npx cap open ios       # then Product → Archive in Xcode
npx cap open android   # then Build → Generate Signed Bundle in Android Studio
```

## Notes

- Firebase Auth and Firestore work inside the Capacitor web view with the same `public/firebase-config.json`. Add `capacitor://localhost` and `http://localhost` to Firebase → Authentication → Authorized domains.
- The share buttons in **Share plan** use the Web Share API, which Capacitor's web view supports on iOS 15+ and Android 10+.
- Offline persistence (IndexedDB) works unchanged.

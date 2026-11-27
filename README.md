# FitCoach (Android)

Offline adaptive exercise planner. Everything runs on the phone and data stays on the phone.

## Get the APK (pick one)

1. **GitHub (no installs):** create a new GitHub repo, upload this whole folder, open the
   **Actions** tab, run **Build APK** (it also runs on every push). Download **FitCoach-apk**
   from the finished run and unzip it.
2. **Android Studio:** open the `android/` folder, wait for Gradle sync, then
   Build > Build APK(s). The file lands in `android/app/build/outputs/apk/debug/`.
3. **Command line** (JDK 17 + Android SDK installed): `npm ci && npm run build:debug`.

## Install
Copy `app-debug.apk` to the phone, open it, and allow "install unknown apps" when asked.

## Optional local AI
Profile > Local AI server: enter the address of Ollama on your PC (same Wi-Fi), for example
`http://192.168.1.20:11434`. On the PC run Ollama with `OLLAMA_HOST=0.0.0.0`. Leave it empty
and the app uses its built-in rules only.

## Edit the web app
Files are in `www/`. After changes run `npx cap sync android` and rebuild.
Not medical advice.

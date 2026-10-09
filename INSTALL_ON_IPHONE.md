# Put LUNAVIA on your iPhone

This guide assumes no programming experience. You need:

- A **Mac** (any Mac that can run the latest Xcode).
- Your **iPhone** and its **USB cable**.
- Your **Apple ID** (the same one you use for the App Store). A paid developer account is **not** needed.
- About **30 minutes** the first time (most of it is waiting for downloads).

---

## Part 1 — Get the tools (one time only)

1. On your Mac, open the **App Store** app.
2. Search for **Xcode**. Click **Get**, then **Install**. It is large (several GB), so wait until it finishes.
3. Open **Xcode** once (from Launchpad or the Applications folder).
   - If it asks to install **additional components**, click **Install**.
   - If it asks which platforms to download, make sure **iOS** is ticked and click **Download & Install**.

## Part 2 — Download LUNAVIA

1. On your Mac, open the LUNAVIA page on GitHub: `https://github.com/Hevoliveira/lunavia`
2. Above the file list there is a button showing the branch name (it usually says **main**). Click it and choose **claude/ios-app**.
   *(Once the iPhone version has been merged, you can stay on **main**.)*
3. Click the green **Code** button, then **Download ZIP**.
4. Open your **Downloads** folder and **double-click the ZIP file** to unpack it. You now have a folder called something like `lunavia-claude-ios-app`.

## Part 3 — Open the project in Xcode

1. Open that folder, then open **frontend**, then **ios**, then **App**.
2. **Double-click `App.xcodeproj`** (the blue icon). Xcode opens.
3. If Xcode asks whether you trust the project, click **Trust and Open**.
4. Wait. At the top of the Xcode window you will see messages such as *"Resolving Package Graph"* or *"Fetching capacitor-swift-pm"*. Let them finish (this needs an internet connection the first time).

## Part 4 — Add your Apple account to Xcode (one time only)

1. In the menu bar at the very top of the screen, click **Xcode**, then **Settings…**
2. Click the **Accounts** tab.
3. Click the **+** button at the bottom left, choose **Apple ID**, click **Continue**, and sign in.
4. Close the Settings window.

## Part 5 — Let Xcode sign the app with your account

1. In the **left-hand column** of Xcode, click the blue **App** icon at the very top.
2. In the middle area, under **TARGETS**, click **App**.
3. Click the **Signing & Capabilities** tab.
4. Make sure **Automatically manage signing** is ticked.
5. Next to **Team**, open the menu and choose **your name (Personal Team)**.
6. If a red message says the **Bundle Identifier** is not available, click into the **Bundle Identifier** box and change it to something unique to you, for example `com.yourname.lunavia`. Press Return. The red message should disappear.

## Part 6 — Connect your iPhone

1. Plug your iPhone into the Mac with the cable and **unlock** the iPhone.
2. If the iPhone asks **"Trust This Computer?"**, tap **Trust** and enter your iPhone passcode.
3. **Turn on Developer Mode** (iPhones with iOS 16 or newer — needed once):
   - On the iPhone open **Settings → Privacy & Security**.
   - Scroll to the bottom and tap **Developer Mode** *(it appears after the iPhone has been connected to Xcode; if you don't see it yet, do steps 1–2 of Part 7 first, then come back)*.
   - Switch it **on**, tap **Restart**, and after the restart tap **Turn On** and enter your passcode.

## Part 7 — Install LUNAVIA

1. At the **top centre** of the Xcode window there is a box showing **App ›** followed by a device name. Click the device name.
2. In the list, under **iOS Device**, choose **your iPhone**.
3. Click the **▶ (Play)** button at the top left of the Xcode window.
4. The first build takes a few minutes. When the top of Xcode says **"Running App on …"** (the project is called "App"; the icon on your phone says LUNAVIA), look at your iPhone.

## Part 8 — Allow the app on the iPhone (first time only)

If the iPhone shows **"Untrusted Developer"** instead of opening the game:

1. On the iPhone open **Settings → General → VPN & Device Management**.
2. Under **Developer App**, tap **your Apple ID**.
3. Tap **Trust "…your Apple ID…"**, then **Trust** again.
4. Go back to the Home Screen and tap the **LUNAVIA** icon (or press **▶** in Xcode again).

---

## Playing

- Turn the iPhone **sideways** — LUNAVIA runs in landscape.
- **Sound starts after your first tap.** If you hear nothing, check the volume buttons.
- All flight controls are on-screen buttons: **press and hold** them (you can hold two at once, e.g. throttle and a side thruster).
- The game does **not** need an internet connection once installed.

## Check which version is on your iPhone

Open LUNAVIA. On the first screen, at the **top left**, under *LAT 28.5°N · LON −80.6°W*, there is a line like:

> **LUNAVIA iOS · BUILD 1a2b3c4 · 2026-10-09 03:10 UTC**

- **BUILD** is the version of the game inside the app, and the date is when it was built. Compare them with the latest version named on GitHub (the description of the iPhone pull request lists the expected **BUILD** code).
- If this line is **missing**, the iPhone is still running an old copy. Do the update below again, without skipping the steps marked **Important**.
- Tap the line to show more details (screen size and **PHONE LAYOUT ON**). Send a photo of it if something still looks wrong.

## Updating LUNAVIA to a new version

You do **not** need to run any script or install anything extra: the downloaded folder already contains the finished game. You only replace the folder and install again with Xcode.

1. **Close Xcode** (menu **Xcode → Quit Xcode**).
2. **Important — delete the old app from the iPhone.** On the iPhone, touch and hold the **LUNAVIA** icon, tap **Remove App**, then **Delete App**, then **Delete**. *(This removes every old file. Your 7-day signing is renewed by the new install anyway.)*
3. **Important — throw away the old folder.** In **Finder**, open **Downloads** and drag **every** old LUNAVIA folder (`lunavia-claude-ios-app`, `lunavia-claude-ios-app 2`, …) and old LUNAVIA ZIP files to the **Trash**. Then right-click the Trash and choose **Empty Trash**. This way you cannot open an old copy by mistake.
4. Download the new version exactly as in **Part 2** (branch **claude/ios-app**, green **Code** button, **Download ZIP**, then double-click the ZIP).
5. **Important — open the new project from Finder, not from Xcode's list of recent projects.** Open the new folder → **frontend → ios → App** → double-click **App.xcodeproj**. Wait for the package messages at the top of Xcode to finish.
6. Check **Signing & Capabilities** again (**Part 5**): your **Team** must be selected. If you had changed the **Bundle Identifier** last time (for example to `com.yourname.lunavia`), type that **same** identifier again.
7. **Important — clean the old build.** In the menu bar choose **Product → Clean Build Folder** (or press **Shift ⇧ + Command ⌘ + K**). Wait a few seconds until the top of Xcode says *Clean Finished*.
8. Connect the iPhone, pick it at the top of Xcode, and press **▶** (**Part 7**). If the iPhone says **Untrusted Developer** again, repeat **Part 8**.
9. Open LUNAVIA and check the **BUILD** line (see *Check which version is on your iPhone* above).

## Good to know

- With a free Apple account, an app you install yourself **stops opening after 7 days**. To renew it: connect the iPhone, open the project in Xcode, and press **▶** again. Your iPhone keeps the app; it just gets a fresh 7 days.
- With a paid Apple Developer account (99 USD/year) the app lasts one year and can later be shared through **TestFlight**.
- If something goes wrong, unplug and replug the iPhone, make sure it is unlocked, and press **▶** again.

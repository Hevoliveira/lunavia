import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = LunaviaViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// LUNAVIA's game screen: the Capacitor web view, full screen in landscape,
/// with no status bar and screen-edge swipes deferred so a thumb on the flight
/// controls doesn't trigger a system gesture.
///
/// The Home Indicator is auto-hidden through Capacitor's built-in SystemBars
/// plugin (`plugins.SystemBars.hidden` in capacitor.config.json). Capacitor 8
/// declares `prefersHomeIndicatorAutoHidden` as `public` (not `open`) on
/// CAPBridgeViewController, so it must not be overridden here: Xcode rejects
/// that with "Overriding non-open property outside of its defining module".
class LunaviaViewController: CAPBridgeViewController {
    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func capacitorDidLoad() {
        view.backgroundColor = UIColor(red: 5 / 255, green: 5 / 255, blue: 5 / 255, alpha: 1)
        if let webView = webView {
            webView.isOpaque = false
            webView.backgroundColor = view.backgroundColor
            webView.scrollView.backgroundColor = view.backgroundColor
            webView.scrollView.bounces = false
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.allowsLinkPreview = false
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Missions last several minutes without touches during cinematics:
        // keep the screen from dimming and locking mid-flight.
        UIApplication.shared.isIdleTimerDisabled = true
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
    }
}

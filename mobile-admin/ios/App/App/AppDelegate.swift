import UIKit
import Capacitor
import Photos

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.backgroundColor = UIColor(red: 0.031, green: 0.020, blue: 0.047, alpha: 1)
        window?.rootViewController = VipGeceBridgeViewController()
        window?.makeKeyAndVisible()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

@objc(VipGeceBridgeViewController)
class VipGeceBridgeViewController: CAPBridgeViewController {
    override open func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.031, green: 0.020, blue: 0.047, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = UIColor(red: 0.031, green: 0.020, blue: 0.047, alpha: 1)
        webView?.scrollView.backgroundColor = UIColor(red: 0.031, green: 0.020, blue: 0.047, alpha: 1)
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(VipGeceGalleryPlugin())
    }
}

@objc(VipGeceGalleryPlugin)
public class VipGeceGalleryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VipGeceGalleryPlugin"
    public let jsName = "VipGeceGallery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveImage", returnType: CAPPluginReturnPromise)
    ]

    @objc func saveImage(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Kaydedilecek gorsel URL'i bos.")
            return
        }

        let filename = sanitizeFilename(call.getString("filename") ?? "vip-gece-\(Int(Date().timeIntervalSince1970)).jpg")

        URLSession.shared.dataTask(with: url) { data, _, error in
            if let error = error {
                DispatchQueue.main.async { call.reject(error.localizedDescription) }
                return
            }

            guard let data = data, let image = UIImage(data: data) else {
                DispatchQueue.main.async { call.reject("Gorsel verisi okunamadi.") }
                return
            }

            self.requestPhotoAccess { granted in
                guard granted else {
                    DispatchQueue.main.async { call.reject("Fotograflar galerisine yazma izni verilmedi.") }
                    return
                }

                PHPhotoLibrary.shared().performChanges({
                    PHAssetChangeRequest.creationRequestForAsset(from: image)
                }) { success, saveError in
                    DispatchQueue.main.async {
                        if let saveError = saveError {
                            call.reject(saveError.localizedDescription)
                            return
                        }

                        guard success else {
                            call.reject("Gorsel galeriye kaydedilemedi.")
                            return
                        }

                        call.resolve([
                            "saved": true,
                            "uri": "photos://\(filename)",
                            "filename": filename
                        ])
                    }
                }
            }
        }.resume()
    }

    private func requestPhotoAccess(_ completion: @escaping (Bool) -> Void) {
        if #available(iOS 14, *) {
            let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            if status == .authorized || status == .limited {
                completion(true)
                return
            }
            if status == .denied || status == .restricted {
                completion(false)
                return
            }
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { nextStatus in
                completion(nextStatus == .authorized || nextStatus == .limited)
            }
            return
        }

        let status = PHPhotoLibrary.authorizationStatus()
        if status == .authorized {
            completion(true)
            return
        }
        if status == .denied || status == .restricted {
            completion(false)
            return
        }
        PHPhotoLibrary.requestAuthorization { nextStatus in
            completion(nextStatus == .authorized)
        }
    }

    private func sanitizeFilename(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        let cleanedScalars = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        let cleaned = String(cleanedScalars).trimmingCharacters(in: CharacterSet(charactersIn: "-."))
        if cleaned.isEmpty { return "vip-gece-\(Int(Date().timeIntervalSince1970)).jpg" }
        return String(cleaned.prefix(90))
    }
}

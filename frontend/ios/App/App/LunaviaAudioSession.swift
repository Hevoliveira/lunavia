import Foundation
import UIKit
import AVFoundation
import Capacitor

/// LUNAVIA's audio session (the web side is src/audio/nativeAudio.js).
///
/// All of the game's sound (engines, effects, Houston) is Web Audio inside the web view. On an
/// iPhone the app's audio session decides whether that sound reaches the speaker:
///
///   playback  game audio plays even with the iPhone's Silent Mode on, mixed with other apps'
///             audio (the AUDIO setting "SILENT MODE: PLAY SOUND", the default);
///   ambient   game audio follows the Silent Mode switch, so it is muted while the iPhone is
///             silenced (the setting "SILENT MODE: FOLLOW IPHONE").
///
/// The player chooses in AUDIO; the media volume buttons and the output route (speaker,
/// headphones, Bluetooth) are always the iPhone's own. status() reports the session as the
/// system sees it, for AUDIO DIAGNOSTICS: category, media volume, output route.
///
/// Registered by LunaviaViewController.capacitorDidLoad (SceneDelegate.swift); the web side
/// reaches it as window.Capacitor.Plugins.LunaviaAudio.
@objc(LunaviaAudioPlugin)
public class LunaviaAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LunaviaAudioPlugin"
    public let jsName = "LunaviaAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise)
    ]

    /// The last error from setting the session up (empty when it worked).
    private static var lastError = ""

    /// Sets the app's audio session: playback (sound in Silent Mode) or ambient (follows it).
    @discardableResult
    static func apply(playInSilentMode: Bool) -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            if playInSilentMode {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            } else {
                try session.setCategory(.ambient, mode: .default, options: [])
            }
            try session.setActive(true)
            lastError = ""
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    /// Only plain strings, numbers and booleans, so the bridge passes them through unchanged.
    static func describe() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        let outputs = session.currentRoute.outputs
            .map { "\($0.portType.rawValue):\($0.portName)" }
            .joined(separator: ", ")
        return [
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "mixWithOthers": session.categoryOptions.contains(.mixWithOthers),
            "outputVolume": Double(session.outputVolume),
            "outputs": outputs,
            "otherAudioPlaying": session.isOtherAudioPlaying,
            "secondaryAudioSilenced": session.secondaryAudioShouldBeSilencedHint,
            "sampleRate": session.sampleRate,
            "ios": UIDevice.current.systemVersion,
            "error": lastError
        ]
    }

    /// The session as the system reports it now.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve(LunaviaAudioPlugin.describe())
    }

    /// { playInSilentMode: Bool }: applies the player's choice, then reports the session.
    @objc func configure(_ call: CAPPluginCall) {
        let play = call.getBool("playInSilentMode") ?? true
        LunaviaAudioPlugin.apply(playInSilentMode: play)
        call.resolve(LunaviaAudioPlugin.describe())
    }
}

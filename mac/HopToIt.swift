// Hop To It for Mac: a menu bar app with a floating window that shows the
// tracker, with real macOS frosted glass behind it in Glass mode.
import Cocoa
import ServiceManagement
import WebKit

private let defaultURL = "https://hoptrack-eta.vercel.app/"

// MARK: bunny drawing (same shapes as the web bunny, in its 240 x 132 space)

private func ellipse(_ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat, rotate deg: CGFloat = 0) -> NSBezierPath {
  let p = NSBezierPath(ovalIn: NSRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2))
  if deg != 0 {
    var t = AffineTransform(translationByX: cx, byY: cy)
    t.rotate(byDegrees: deg)
    t.translate(x: -cx, y: -cy)
    p.transform(using: t)
  }
  return p
}

private func quad(_ p: NSBezierPath, from p0: NSPoint, control c: NSPoint, to p2: NSPoint) {
  p.move(to: p0)
  p.curve(to: p2,
          controlPoint1: NSPoint(x: p0.x + 2 / 3 * (c.x - p0.x), y: p0.y + 2 / 3 * (c.y - p0.y)),
          controlPoint2: NSPoint(x: p2.x + 2 / 3 * (c.x - p2.x), y: p2.y + 2 / 3 * (c.y - p2.y)))
}

/// Draws the bunny in a y-down context already scaled to bunny units.
private func drawBunny(stroke: NSColor, fill: NSColor, blush: NSColor?, width: CGFloat, simple: Bool) {
  stroke.setStroke()
  let shapes = [ellipse(104, 34, 10.5, 27, rotate: -7), ellipse(136, 33, 10.5, 28, rotate: 6), ellipse(120, 86, 40, 32)]
  for s in shapes {
    s.lineWidth = width
    fill.setFill(); s.fill(); s.stroke()
  }
  if simple { return }
  if let blush = blush {
    blush.setFill()
    ellipse(96, 95, 6, 3.2).fill()
    ellipse(144, 95, 6, 3.2).fill()
  }
  stroke.setFill()
  ellipse(105, 84, 3.2, 3.2).fill()
  ellipse(135, 84, 3.2, 3.2).fill()
  let mouth = NSBezierPath()
  mouth.lineWidth = width * 0.8
  mouth.lineCapStyle = .round
  mouth.move(to: NSPoint(x: 120, y: 93)); mouth.line(to: NSPoint(x: 120, y: 96.5))
  quad(mouth, from: NSPoint(x: 120, y: 96.5), control: NSPoint(x: 117, y: 100.5), to: NSPoint(x: 113, y: 99))
  quad(mouth, from: NSPoint(x: 120, y: 96.5), control: NSPoint(x: 123, y: 100.5), to: NSPoint(x: 127, y: 99))
  mouth.stroke()
  let desk = NSBezierPath()
  desk.lineWidth = width; desk.lineCapStyle = .round
  desk.move(to: NSPoint(x: 70, y: 118)); desk.line(to: NSPoint(x: 170, y: 118))
  desk.stroke()
  for paw in [ellipse(101, 117, 13, 7), ellipse(139, 117, 13, 7)] {
    paw.lineWidth = width
    fill.setFill(); paw.fill(); paw.stroke()
  }
}

/// Renders a square PNG of the app icon.
private func iconPNG(size: Int) -> Data? {
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
  NSGraphicsContext.saveGraphicsState()
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  let s = CGFloat(size)
  let cg = ctx.cgContext
  cg.translateBy(x: 0, y: s); cg.scaleBy(x: 1, y: -1)
  let inset = s * 100 / 1024, body = s - inset * 2
  let tile = NSBezierPath(roundedRect: NSRect(x: inset, y: inset, width: body, height: body), xRadius: body * 0.225, yRadius: body * 0.225)
  NSGradient(colors: [NSColor(red: 1, green: 0.86, blue: 0.91, alpha: 1), NSColor(red: 0.86, green: 0.84, blue: 1, alpha: 1)])!.draw(in: tile, angle: 90)
  let scale = body * 0.0078
  cg.saveGState()
  cg.translateBy(x: s / 2 - 120 * scale, y: s / 2 - 66 * scale + body * 0.03)
  cg.scaleBy(x: scale, y: scale)
  drawBunny(stroke: NSColor(red: 0.17, green: 0.16, blue: 0.2, alpha: 1), fill: .white,
            blush: NSColor(red: 1, green: 0.55, blue: 0.67, alpha: 0.55), width: 4.2, simple: false)
  cg.restoreGState()
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])
}

private func menuBarImage() -> NSImage {
  let img = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
    guard let cg = NSGraphicsContext.current?.cgContext else { return false }
    let k: CGFloat = 17 / 120
    cg.translateBy(x: 9 - 120 * k, y: 0.5 - 4 * k)
    cg.scaleBy(x: k, y: k)
    drawBunny(stroke: .black, fill: .clear, blush: nil, width: 1.5 / k, simple: true)
    return true
  }
  img.isTemplate = true
  return img
}

// MARK: app

final class DragStrip: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, NSWindowDelegate {
  private var window: NSWindow!
  private var glass: NSVisualEffectView!
  private var web: WKWebView!
  private var status: NSStatusItem!
  private var pinItem: NSMenuItem!
  private var miniItem: NSMenuItem!
  private var loginItem: NSMenuItem!
  private var isMini = false
  private var fullHeight: CGFloat = 760
  private let defaults = UserDefaults.standard

  private var siteURL: URL {
    URL(string: defaults.string(forKey: "url") ?? defaultURL) ?? URL(string: defaultURL)!
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMainMenu()
    buildWindow()
    buildStatusItem()
    show()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { show(); return true }

  private func buildWindow() {
    let frame = NSRect(x: 0, y: 0, width: 390, height: fullHeight)
    window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.title = "Hop To It"
    window.isMovableByWindowBackground = true
    window.standardWindowButton(.miniaturizeButton)?.isHidden = true
    window.standardWindowButton(.zoomButton)?.isHidden = true
    window.minSize = NSSize(width: 300, height: 180)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.backgroundColor = .clear
    window.isOpaque = false
    window.setFrameAutosaveName("HopToItMain")
    if !window.setFrameUsingName("HopToItMain") { window.center() }
    fullHeight = max(window.frame.height, 500)

    let root = NSView(frame: frame)
    root.autoresizingMask = [.width, .height]
    glass = NSVisualEffectView(frame: frame)
    glass.autoresizingMask = [.width, .height]
    glass.material = .popover
    glass.blendingMode = .behindWindow
    glass.state = .active
    root.addSubview(glass)

    let config = WKWebViewConfiguration()
    config.applicationNameForUserAgent = "HopToItMac/1.0"
    config.websiteDataStore = .default()
    config.userContentController.add(self, name: "hop")
    web = WKWebView(frame: frame, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    web.uiDelegate = self
    web.navigationDelegate = self
    root.addSubview(web)

    let strip = DragStrip(frame: NSRect(x: 70, y: frame.height - 28, width: frame.width - 70, height: 28))
    strip.autoresizingMask = [.width, .minYMargin]
    root.addSubview(strip)

    window.contentView = root
    applyPin(defaults.bool(forKey: "pinned"))
    web.load(URLRequest(url: siteURL))
  }

  private func buildStatusItem() {
    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    status.button?.image = menuBarImage()
    status.button?.toolTip = "Hop To It"
    let menu = NSMenu()
    menu.addItem(withTitle: "Show Hop To It", action: #selector(toggleWindow), keyEquivalent: "")
    miniItem = menu.addItem(withTitle: "Mini Mode", action: #selector(toggleMini), keyEquivalent: "")
    pinItem = menu.addItem(withTitle: "Keep on Top", action: #selector(togglePin), keyEquivalent: "")
    loginItem = menu.addItem(withTitle: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
    menu.addItem(.separator())
    menu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "")
    menu.addItem(withTitle: "Quit Hop To It", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.items.forEach { if $0.action != #selector(NSApplication.terminate(_:)) { $0.target = self } }
    menu.delegate = self
    status.menu = menu
    refreshMenu()
  }

  private func buildMainMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Hide Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    appMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r").target = self
    appMenu.addItem(withTitle: "Quit Hop To It", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    NSApp.mainMenu = main
  }

  private func refreshMenu() {
    status.menu?.items.first?.title = window.isVisible ? "Hide Hop To It" : "Show Hop To It"
    miniItem.state = isMini ? .on : .off
    pinItem.state = defaults.bool(forKey: "pinned") ? .on : .off
    loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
  }

  private func show() {
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }

  @objc private func toggleWindow() {
    if window.isVisible && NSApp.isActive { window.orderOut(nil) } else { show() }
  }
  @objc private func toggleMini() {
    web.evaluateJavaScript("window.hopSetMini && window.hopSetMini(\(!isMini))")
    show()
  }
  @objc private func togglePin() { applyPin(!defaults.bool(forKey: "pinned")) }
  @objc private func reload() { web.load(URLRequest(url: siteURL)) }
  @objc private func toggleLogin() {
    do {
      if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
      else { try SMAppService.mainApp.register() }
    } catch {
      let a = NSAlert()
      a.messageText = "Could not change Open at Login"
      a.informativeText = "You can add Hop To It in System Settings, General, Login Items."
      a.runModal()
    }
    refreshMenu()
  }

  private func applyPin(_ on: Bool) {
    defaults.set(on, forKey: "pinned")
    window.level = on ? .floating : .normal
    window.collectionBehavior = on ? [.canJoinAllSpaces, .fullScreenAuxiliary] : []
  }

  private func setMini(_ mini: Bool) {
    if !isMini { fullHeight = window.frame.height }
    isMini = mini
    let top = window.frame.maxY
    if mini {
      web.evaluateJavaScript("Math.ceil(document.querySelector('.card').getBoundingClientRect().height + 48)") { [weak self] h, _ in
        guard let self = self else { return }
        let height = max(170, (h as? NSNumber).map { CGFloat(truncating: $0) } ?? 220)
        self.resize(width: 330, height: height, top: top)
      }
    } else {
      resize(width: max(window.frame.width, 360), height: max(fullHeight, 520), top: top)
    }
    refreshMenu()
  }

  private func resize(width: CGFloat, height: CGFloat, top: CGFloat) {
    var f = window.frame
    f.size = NSSize(width: width, height: height)
    f.origin.y = top - height
    window.setFrame(f, display: true, animate: true)
  }

  // MARK: page bridge

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any] else { return }
    if let mini = body["mini"] as? Bool, mini != isMini { setMini(mini) }
    if let isGlass = body["glass"] as? Bool {
      glass.isHidden = !isGlass
      let dark = body["dark"] as? Bool ?? false
      window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      window.backgroundColor = isGlass ? .clear : (dark ? NSColor(red: 0.082, green: 0.082, blue: 0.106, alpha: 1) : NSColor(red: 0.969, green: 0.957, blue: 0.937, alpha: 1))
      window.isOpaque = !isGlass
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let html = "<html style='font:600 14px -apple-system;color:#8a8794;display:grid;place-items:center;height:100%'><body>No connection yet. Trying again...</body></html>"
    webView.loadHTMLString(html, baseURL: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.reload() }
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { decisionHandler(.download); return }
    if let url = action.request.url, action.navigationType == .linkActivated, url.host != siteURL.host {
      NSWorkspace.shared.open(url); decisionHandler(.cancel); return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var url = folder.appendingPathComponent(suggestedFilename)
    var n = 1
    while FileManager.default.fileExists(atPath: url.path) {
      url = folder.appendingPathComponent("\((suggestedFilename as NSString).deletingPathExtension) \(n).\((suggestedFilename as NSString).pathExtension)")
      n += 1
    }
    completionHandler(url)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = message
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message
    a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let p = NSOpenPanel()
    p.canChooseFiles = true
    p.allowsMultipleSelection = parameters.allowsMultipleSelection
    p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
  }

  func windowDidEndLiveResize(_ notification: Notification) {
    if !isMini { fullHeight = window.frame.height }
  }
  func windowDidBecomeKey(_ notification: Notification) { refreshMenu() }
}

extension AppDelegate: NSMenuDelegate {
  func menuWillOpen(_ menu: NSMenu) { refreshMenu() }
}

@main
enum Main {
  static func main() {
    let args = CommandLine.arguments
    if args.count == 3, args[1] == "--icons" {
      let dir = URL(fileURLWithPath: args[2])
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128),
                         ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
        try? iconPNG(size: px)?.write(to: dir.appendingPathComponent("icon_\(name).png"))
      }
      return
    }
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }
}

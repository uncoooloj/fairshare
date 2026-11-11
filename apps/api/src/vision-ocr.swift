import AppKit
import Foundation
import PDFKit
import Vision

let maximumPageCount = 5
// The primary pass reads at higher resolution (short lines such as a lone payee
// name are dropped at 2000 px). A second, language-corrected pass at a different
// resolution is only used to find lines the two passes disagree on.
let primaryDimension = 3000.0
let checkDimension = 2000.0
let maximumCharacterCount = 40_000

// Local input only. Never log document content or paths on failure.
func fail(_ code: String) -> Never {
  print("{\"error\":\"\(code)\"}")
  exit(0)
}

guard CommandLine.arguments.count == 2 else {
  fail("OCR_FAILED")
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: sourceURL) else {
  fail("INVALID_PDF")
}
guard !document.isEncrypted else {
  fail("OCR_ENCRYPTED")
}
guard (1...maximumPageCount).contains(document.pageCount) else {
  fail("OCR_PAGE_LIMIT")
}

func render(_ page: PDFPage, bounds: CGRect, dimension: Double) -> CGImage {
  let scale = min(dimension / bounds.width, dimension / bounds.height)
  let width = max(1, Int(ceil(bounds.width * scale)))
  let height = max(1, Int(ceil(bounds.height * scale)))
  guard
    let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    fail("OCR_FAILED")
  }

  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.scaleBy(x: scale, y: scale)
  context.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
  page.draw(with: .mediaBox, to: context)
  guard let image = context.makeImage() else {
    fail("OCR_FAILED")
  }
  return image
}

// Lines in page points with y growing upwards, like the PDF text layer.
func recognize(_ image: CGImage, bounds: CGRect, languageCorrection: Bool) -> [[String: Any]] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["en-US"]
  request.usesLanguageCorrection = languageCorrection
  do {
    try VNImageRequestHandler(cgImage: image).perform([request])
  } catch {
    fail("OCR_FAILED")
  }
  return (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return [
      "text": candidate.string,
      "confidence": Double(candidate.confidence),
      "x": Double(box.minX * bounds.width),
      "y": Double(box.minY * bounds.height),
      "right": Double(box.maxX * bounds.width),
      "size": Double(box.height * bounds.height),
    ]
  }
}

var pages = [[String: Any]]()
var characterCount = 0
for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else {
    fail("OCR_FAILED")
  }

  let bounds = page.bounds(for: .mediaBox)
  guard bounds.width > 0, bounds.height > 0, bounds.width.isFinite, bounds.height.isFinite else {
    fail("OCR_FAILED")
  }

  let lines = recognize(
    render(page, bounds: bounds, dimension: primaryDimension), bounds: bounds,
    languageCorrection: false)
  let check = recognize(
    render(page, bounds: bounds, dimension: checkDimension), bounds: bounds,
    languageCorrection: true)
  characterCount += lines.reduce(2) { $0 + (($1["text"] as? String)?.utf16.count ?? 0) + 1 }
  if characterCount > maximumCharacterCount {
    fail("OCR_TEXT_LIMIT")
  }
  pages.append(["lines": lines, "check": check])
}

guard let output = try? JSONSerialization.data(withJSONObject: ["pages": pages]),
  let json = String(data: output, encoding: .utf8)
else {
  fail("OCR_FAILED")
}
print(json)

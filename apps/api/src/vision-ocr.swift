import AppKit
import Foundation
import PDFKit
import Vision

let maximumPageCount = 5
let maximumDimension = 2000.0
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

var pages = [String]()
for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else {
    fail("OCR_FAILED")
  }

  let bounds = page.bounds(for: .mediaBox)
  guard bounds.width > 0, bounds.height > 0, bounds.width.isFinite, bounds.height.isFinite else {
    fail("OCR_FAILED")
  }

  let scale = min(maximumDimension / bounds.width, maximumDimension / bounds.height)
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

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["en-US"]
  request.usesLanguageCorrection = false
  do {
    try VNImageRequestHandler(cgImage: image).perform([request])
  } catch {
    fail("OCR_FAILED")
  }

  let text = (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: "\n")
  pages.append(text)
  if pages.joined(separator: "\n\n").utf16.count > maximumCharacterCount {
    fail("OCR_TEXT_LIMIT")
  }
}

guard let output = try? JSONSerialization.data(withJSONObject: ["pages": pages]),
  let json = String(data: output, encoding: .utf8)
else {
  fail("OCR_FAILED")
}
print(json)

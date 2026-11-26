import XCTest
@testable import BridgeCore

final class PlaceholderTests: XCTestCase {
  func testBuilds() {
    XCTAssertEqual(BridgeCoreVersion.value, 1)
  }
}

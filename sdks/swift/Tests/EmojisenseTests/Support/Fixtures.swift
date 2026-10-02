@testable import Emojisense

/// The small packs of packages/core/test/fixture.ts.
enum Fixtures {
  static let english = Pack(
    packVersion: "test", locale: "en", emojiVersion: "17.0", groups: ["test"],
    emoji: [
      PackRow(
        emoji: "👍", hexcode: "1F44D", label: "thumbs up", shortcode: "+1|thumbsup",
        keyword: "good|like|yes", alias: "lgtm|approve"),
      PackRow(
        emoji: "🔥", hexcode: "1F525", label: "fire", keyword: "flame|hot",
        alias: "on fire|lit|hotfix"),
      PackRow(emoji: "🚒", hexcode: "1F692", label: "fire engine", keyword: "engine|truck"),
      PackRow(
        emoji: "🚀", hexcode: "1F680", label: "rocket", keyword: "space",
        alias: "ship it|launch|deploy|to the moon"),
      PackRow(
        emoji: "🦖", hexcode: "1F996", label: "T-Rex", keyword: "dinosaur|tyrannosaurus",
        alias: "jurassic park|dino", typo: "dinasour"),
      PackRow(emoji: "🐐", hexcode: "1F410", label: "goat", alias: "greatest of all time|goat"),
      PackRow(
        emoji: "🎃", hexcode: "1F383", label: "jack-o-lantern", keyword: "halloween|pumpkin"),
      PackRow(
        emoji: "🎂", hexcode: "1F382", label: "birthday cake", keyword: "birthday|cake",
        alias: "happy birthday"),
    ])

  static let turkish = Pack(
    packVersion: "test", locale: "tr", emojiVersion: "17.0", groups: ["test"],
    emoji: [
      PackRow(emoji: "👍", hexcode: "1F44D", label: "baş parmak yukarıda", keyword: "tamam|onay"),
      PackRow(
        emoji: "🎂", hexcode: "1F382", label: "doğum günü pastası", keyword: "dogum gunu|pasta",
        alias: "iyi ki dogdun"),
    ])
}

plugins {
    // Downloads the JDK of the toolchain when the machine has none (CI images, fresh laptops).
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "emojisense"

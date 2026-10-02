import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-library`
    `maven-publish`
    kotlin("jvm") version "2.4.20"
}

group = "com.emojisense"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}

// Compile with JDK 21, emit Java 8 bytecode: the jar runs on every JVM 8+ server and on Android.
kotlin {
    jvmToolchain(21)
    explicitApi()
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
    withSourcesJar()
}

val repositoryRoot: File = rootDir.resolve("../..").canonicalFile

tasks.test {
    useJUnitPlatform()
    // The conformance tests read the shared golden file and the built packs of the monorepo. They are
    // inputs, so the tests run again when either changes.
    systemProperty("emojisense.repositoryRoot", repositoryRoot.path)
    environment("EMOJISENSE_PACK_DIR", System.getenv("EMOJISENSE_PACK_DIR") ?: "")
    environment("EMOJISENSE_GOLDEN", System.getenv("EMOJISENSE_GOLDEN") ?: "")
    inputs.files(repositoryRoot.resolve("sdks/swift/Tests/EmojisenseTests/Resources/golden.json"))
        .withPropertyName("golden").withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.files(fileTree(repositoryRoot.resolve("packages/data/dist/packs")) { include("*/pack.*.json") })
        .withPropertyName("packs").withPathSensitivity(PathSensitivity.RELATIVE)
    maxHeapSize = "1g"
    testLogging {
        events("failed", "skipped")
        // Conformance reports ("conformance: … 217/217 (100.0%)") are printed to stdout.
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            pom {
                name.set("Emojisense")
                description.set("Semantic emoji search for Android and the JVM: offline alias search, culture layer and the Emojisense API.")
                url.set("https://emojisense.com")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        name.set("Mehmet Ali Peker")
                    }
                }
            }
        }
    }
}

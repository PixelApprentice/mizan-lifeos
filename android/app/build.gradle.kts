import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The phone UI is the same page the desktop serves; copy it in so there is a single source of truth.
val companionAssets = layout.buildDirectory.dir("generated/companion-assets")
val copyCompanionPage by tasks.registering(Copy::class) {
    from(rootProject.file("../companion/index.html"))
    into(companionAssets)
}

android {
    namespace = "com.salahudin.mizan.companion"
    compileSdk = 35
    // Pin to the build-tools the README installs; AGP's default (34) would need a second download.
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.salahudin.mizan.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 300
        versionName = "0.3.0"
    }

    // play: QR scanning through Google Play services (proprietary library).
    // foss: only free software, for F-Droid and anyone who avoids Google services; paste links instead.
    flavorDimensions += "distribution"
    productFlavors {
        create("play") { dimension = "distribution" }
        create("foss") {
            dimension = "distribution"
            versionNameSuffix = "-foss"
        }
    }

    // Release signing comes from android/keystore.properties (never committed); see docs/release/deploy.md.
    val keystoreFile = rootProject.file("keystore.properties")
    if (keystoreFile.exists()) {
        val props = Properties().apply { keystoreFile.inputStream().use { load(it) } }
        signingConfigs.create("release") {
            storeFile = rootProject.file(props.getProperty("storeFile"))
            storePassword = props.getProperty("storePassword")
            keyAlias = props.getProperty("keyAlias")
            keyPassword = props.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Without a keystore the release APK falls back to debug signing: fine for sideloading, not for a store.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir(companionAssets)
}

tasks.named("preBuild") { dependsOn(copyCompanionPage) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    "playImplementation"("com.google.android.gms:play-services-code-scanner:16.1.0")
}

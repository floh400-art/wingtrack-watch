plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "fr.wingtrack.watch"
    compileSdk = 34

    defaultConfig {
        applicationId = "fr.wingtrack.watch"
        minSdk = 30          // Wear OS 3 : Galaxy Watch 4 et plus récentes
        targetSdk = 34
        versionCode = 3
        versionName = "1.2"
    }

    // Clé fixe : chaque nouvelle version s'installe par-dessus l'ancienne sans perdre les sessions
    signingConfigs {
        create("wingtrack") {
            storeFile = file("wingtrack.keystore")
            storePassword = "android"
            keyAlias = "wingtrack"
            keyPassword = "android"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("wingtrack")
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("wingtrack")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material:1.3.1")
    implementation("androidx.wear.compose:compose-foundation:1.3.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}

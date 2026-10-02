package com.salahudin.mizan.companion

import android.app.Activity
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** Play flavor: Google's code scanner (no camera permission needed; runs in Play services). */
object QrScanner {
    const val AVAILABLE = true

    fun scan(activity: Activity, onCode: (String) -> Unit, onError: (String) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(activity, options).startScan()
            .addOnSuccessListener { code -> code.rawValue?.let(onCode) }
            .addOnFailureListener { error -> onError("Scanner unavailable: ${error.message}.") }
    }
}

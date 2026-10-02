package com.salahudin.mizan.companion

import android.app.Activity

/** FOSS flavor: no proprietary scanner. Links still arrive by paste, share sheet or mizan:// deep links. */
object QrScanner {
    const val AVAILABLE = false

    fun scan(activity: Activity, onCode: (String) -> Unit, onError: (String) -> Unit) {
        onError("This build has no QR scanner.")
    }
}

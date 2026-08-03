import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const SCANNER_ELEMENT_ID = 'qr-scanner-region'

export default function QrScanner({ onScan, onClose }) {
  const [error, setError] = useState('')
  const html5QrCodeRef = useRef(null)
  const hasScannedRef = useRef(false)

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID)
    html5QrCodeRef.current = html5QrCode

    html5QrCode
      .start(
        { facingMode: 'environment' },
        { fps: 10 },
        (decodedText) => {
          if (hasScannedRef.current) return
          hasScannedRef.current = true
          onScan(decodedText)
        },
        () => {
          // per-frame decode failures are expected constantly while aiming — ignore
        },
      )
      .catch((startError) => {
        setError(startError?.message || 'Unable to access camera.')
      })

    return () => {
      const instance = html5QrCodeRef.current
      if (instance) {
        instance
          .stop()
          .catch(() => {})
          .finally(() => instance.clear())
      }
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-4">
        <h2 className="mb-3 text-center text-base font-semibold text-gray-900">Scan QR Code</h2>
        <div id={SCANNER_ELEMENT_ID} className="overflow-hidden rounded-lg bg-gray-100" />
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

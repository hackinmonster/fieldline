import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import Command from './pages/Command'
import { fieldlineUrl } from './api'

/** The volunteer phone is Fieldline (new_reworked_frontend). Old /volunteer links land there, signed in as the same volunteer. */
function ToFieldline() {
  const [params] = useSearchParams()
  useEffect(() => { location.replace(fieldlineUrl(params.get('id') ? Number(params.get('id')) : null)) }, [params])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/command" element={<Command />} />
        <Route path="/volunteer" element={<ToFieldline />} />
        <Route path="*" element={<Navigate to="/command" />} />
      </Routes>
    </BrowserRouter>
  )
}

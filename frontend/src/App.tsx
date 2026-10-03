import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Command from './pages/Command'
import Volunteer from './pages/Volunteer'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/command" element={<Command />} />
        <Route path="/volunteer" element={<Volunteer />} />
        <Route path="*" element={<Navigate to="/command" />} />
      </Routes>
    </BrowserRouter>
  )
}

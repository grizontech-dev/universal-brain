import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import About from './components/About';
import Projects from './components/Projects';
import Contact from './components/Contact';

const App = () => {
  return (
    <Router>
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold text-center my-8">My Portfolio</h1>
        <Routes>
          <Route path="/" element={<About />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
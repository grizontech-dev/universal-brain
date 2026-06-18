const { supabase } = require('../supabase/client');

const submitContactForm = async (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const { data, error } = await supabase
        .from('contact_form_submissions')
        .insert([{ name, email, message }]);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ message: 'Submission successful', data });
};

module.exports = { submitContactForm };
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Button } from '@mui/material';
import { api } from '../../services/api';

interface Slot {
  _id: string;
  name: string;
  assetId?: string;
}

export default function SlotManagement() {
  const { projectId } = useParams();
  const [slots, setSlots] = useState<Slot[]>([]);

  useEffect(() => {
    fetchSlots();
  }, []);

  async function fetchSlots() {
    try {
      const response = await api.get(`/projects/${projectId}/slots`);
      setSlots(response.data);
    } catch (error) {
      console.error('Error fetching slots:', error);
    }
  }

  async function handleCreateSlot() {
    try {
      const response = await api.post(`/projects/${projectId}/slots`, {
        name: `Slot ${slots.length + 1}`
      });
      setSlots([...slots, response.data]);
    } catch (error) {
      console.error('Error creating slot:', error);
    }
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Slot Management
      </Typography>
      <Button variant="contained" onClick={handleCreateSlot}>
        Create Slot
      </Button>
      {slots.map((slot) => (
        <Box key={slot._id} mt={2}>
          <Typography>{slot.name}</Typography>
          {/* Render slot details, upload button, etc. */}
        </Box>
      ))}
    </Box>
  );
}
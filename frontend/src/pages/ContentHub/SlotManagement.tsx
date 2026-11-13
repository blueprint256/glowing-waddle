import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { contentHubAPI } from '../../services/api';

interface Slot {
  _id: string;
  name: string;
  assetId?: { _id: string; storageKey: string } | string;
}

export default function SlotManagement() {
  const { projectId } = useParams<{ projectId: string }>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId) {
      fetchSlots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function fetchSlots() {
    if (!projectId) return;
    try {
      setLoading(true);
      const response = await contentHubAPI.listSlots(projectId);
      setSlots(response.data);
    } catch (error) {
      console.error('Error fetching slots:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSlot() {
    if (!projectId) return;
    try {
      const response = await contentHubAPI.createSlot(projectId, {
        name: `Slot ${slots.length + 1}`
      });
      setSlots([...slots, response.data]);
    } catch (error) {
      console.error('Error creating slot:', error);
    }
  }

  if (!projectId) {
    return <Typography color="error">No project selected.</Typography>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Slot Management
      </Typography>
      <Button variant="contained" onClick={handleCreateSlot}>
        Create Slot
      </Button>
      {loading ? (
        <Box display="flex" justifyContent="center" mt={4}>
          <CircularProgress size={22} />
        </Box>
      ) : (
        slots.map((slot) => (
          <Box key={slot._id} mt={2}>
            <Typography>{slot.name}</Typography>
            {/* Render slot details, upload button, etc. */}
          </Box>
        ))
      )}
    </Box>
  );
}

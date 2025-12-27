import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  SelectChangeEvent,
  Paper,
  Grid,
  Tooltip,
  IconButton,
  Collapse
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  FilterList as FilterListIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';
import { Campaign, Project, CampaignStatus, ProjectStatus, TaskStatus, UserRole } from '../types';
import { campaignAPI, projectAPI, userAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';

export interface FilterOptions {
  search?: string;
  campaignIds?: string[];
  projectIds?: string[];
  statuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  createdBy?: string[];
}

interface FilterToolbarProps {
  filters: FilterOptions;
  onFilterChange: (filters: FilterOptions) => void;
  showCampaignFilter?: boolean;
  showProjectFilter?: boolean;
  showStatusFilter?: boolean;
  statusType?: 'campaign' | 'project' | 'task';
  showDateFilter?: boolean;
  showCreatorFilter?: boolean;
  placeholder?: string;
}

const FilterToolbar: React.FC<FilterToolbarProps> = ({
  filters,
  onFilterChange,
  showCampaignFilter = true,
  showProjectFilter = true,
  showStatusFilter = true,
  statusType = 'task',
  showDateFilter = true,
  showCreatorFilter = true,
  placeholder = 'Search across names and descriptions...'
}) => {
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  // Determine which statuses to show based on type
  const getStatusOptions = () => {
    switch (statusType) {
      case 'campaign':
        return Object.values(CampaignStatus);
      case 'project':
        return Object.values(ProjectStatus);
      case 'task':
        return Object.values(TaskStatus);
      default:
        return Object.values(TaskStatus);
    }
  };

  const statusOptions = getStatusOptions();

  // Load campaigns for filter dropdown
  useEffect(() => {
    const loadCampaigns = async () => {
      try {
        setLoading(true);
        const response = await campaignAPI.getAll({ limit: 1000 });
        setCampaigns(response.data.campaigns || []);
      } catch (error) {
        console.error('Error loading campaigns:', error);
      } finally {
        setLoading(false);
      }
    };

    if (showCampaignFilter) {
      loadCampaigns();
    }
  }, [showCampaignFilter]);

  // Load projects for filter dropdown
  useEffect(() => {
    const loadProjects = async () => {
      try {
        setLoading(true);
        const params: any = { limit: 1000 };
        // If campaigns are filtered, only load projects for those campaigns
        if (filters.campaignIds && filters.campaignIds.length > 0) {
          params.campaignId = filters.campaignIds.join(',');
        }
        const response = await projectAPI.getAll(params);
        setProjects(response.data.projects || []);
      } catch (error) {
        console.error('Error loading projects:', error);
      } finally {
        setLoading(false);
      }
    };

    if (showProjectFilter) {
      loadProjects();
    }
  }, [showProjectFilter, filters.campaignIds]);

  // Load users for creator filter (System Admin only)
  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoading(true);
        const response = await userAPI.getAll();
        setUsers(response.data.users || []);
      } catch (error) {
        console.error('Error loading users:', error);
      } finally {
        setLoading(false);
      }
    };

    if (showCreatorFilter && user?.role === UserRole.SYSTEM_ADMIN) {
      loadUsers();
    }
  }, [showCreatorFilter, user]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ ...filters, search: event.target.value });
  };

  const handleCampaignChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    onFilterChange({
      ...filters,
      campaignIds: typeof value === 'string' ? value.split(',') : value,
      // Clear project filter when campaign changes
      projectIds: []
    });
  };

  const handleProjectChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    onFilterChange({
      ...filters,
      projectIds: typeof value === 'string' ? value.split(',') : value
    });
  };

  const handleStatusChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    onFilterChange({
      ...filters,
      statuses: typeof value === 'string' ? value.split(',') : value
    });
  };

  const handleCreatorChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    onFilterChange({
      ...filters,
      createdBy: typeof value === 'string' ? value.split(',') : value
    });
  };

  const handleDateFromChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ ...filters, dateFrom: event.target.value });
  };

  const handleDateToChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ ...filters, dateTo: event.target.value });
  };

  const handleClearFilters = () => {
    onFilterChange({
      search: '',
      campaignIds: [],
      projectIds: [],
      statuses: [],
      dateFrom: '',
      dateTo: '',
      createdBy: []
    });
  };

  const hasActiveFilters = () => {
    return (
      (filters.search && filters.search.length > 0) ||
      (filters.campaignIds && filters.campaignIds.length > 0) ||
      (filters.projectIds && filters.projectIds.length > 0) ||
      (filters.statuses && filters.statuses.length > 0) ||
      (filters.dateFrom && filters.dateFrom.length > 0) ||
      (filters.dateTo && filters.dateTo.length > 0) ||
      (filters.createdBy && filters.createdBy.length > 0)
    );
  };

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 3,
        backgroundColor: '#f8f9fa',
        borderRadius: 2
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: expanded ? 2 : 0 }}>
        <FilterListIcon sx={{ mr: 1, color: '#1976d2' }} />
        <Box sx={{ fontWeight: 600, fontSize: '1.1rem', color: '#1976d2', flexGrow: 1 }}>
          Filters
          {hasActiveFilters() && (
            <Chip
              label={`${Object.values(filters).filter(v => v && (Array.isArray(v) ? v.length > 0 : v.length > 0)).length} active`}
              size="small"
              color="primary"
              sx={{ ml: 1, height: 20 }}
            />
          )}
        </Box>
        <Tooltip title="Clear all filters">
          <IconButton
            onClick={handleClearFilters}
            disabled={!hasActiveFilters()}
            size="small"
            sx={{ mr: 1 }}
          >
            <ClearIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={expanded ? 'Collapse filters' : 'Expand filters'}>
          <IconButton onClick={() => setExpanded(!expanded)} size="small">
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Collapse in={expanded}>
        <Grid container spacing={2}>
          {/* Global Search */}
          <Grid item xs={12}>
            <TextField
              fullWidth
              placeholder={placeholder}
              value={filters.search || ''}
              onChange={handleSearchChange}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
              }}
              size="small"
            />
          </Grid>

          {/* Campaign Filter */}
          {showCampaignFilter && (
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel id="campaign-filter-label">Campaign</InputLabel>
                <Select
                  labelId="campaign-filter-label"
                  multiple
                  value={filters.campaignIds || []}
                  onChange={handleCampaignChange}
                  input={<OutlinedInput label="Campaign" />}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((value) => {
                        const campaign = campaigns.find((c) => c._id === value);
                        return (
                          <Chip
                            key={value}
                            label={campaign?.name || value}
                            size="small"
                          />
                        );
                      })}
                    </Box>
                  )}
                >
                  {campaigns.map((campaign) => (
                    <MenuItem key={campaign._id} value={campaign._id}>
                      {campaign.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {/* Project Filter */}
          {showProjectFilter && (
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel id="project-filter-label">Project</InputLabel>
                <Select
                  labelId="project-filter-label"
                  multiple
                  value={filters.projectIds || []}
                  onChange={handleProjectChange}
                  input={<OutlinedInput label="Project" />}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((value) => {
                        const project = projects.find((p) => p._id === value);
                        return (
                          <Chip
                            key={value}
                            label={project?.name || value}
                            size="small"
                          />
                        );
                      })}
                    </Box>
                  )}
                  disabled={projects.length === 0}
                >
                  {projects.map((project) => (
                    <MenuItem key={project._id} value={project._id}>
                      {project.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {/* Status Filter */}
          {showStatusFilter && (
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel id="status-filter-label">Status</InputLabel>
                <Select
                  labelId="status-filter-label"
                  multiple
                  value={filters.statuses || []}
                  onChange={handleStatusChange}
                  input={<OutlinedInput label="Status" />}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((value) => (
                        <Chip key={value} label={value} size="small" />
                      ))}
                    </Box>
                  )}
                >
                  {statusOptions.map((status) => (
                    <MenuItem key={status} value={status}>
                      {status}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {/* Creator Filter (System Admin only) */}
          {showCreatorFilter && user?.role === UserRole.SYSTEM_ADMIN && (
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel id="creator-filter-label">Creator</InputLabel>
                <Select
                  labelId="creator-filter-label"
                  multiple
                  value={filters.createdBy || []}
                  onChange={handleCreatorChange}
                  input={<OutlinedInput label="Creator" />}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((value) => {
                        const creator = users.find((u) => u._id === value);
                        return (
                          <Chip
                            key={value}
                            label={creator ? `${creator.firstName} ${creator.lastName}` : value}
                            size="small"
                          />
                        );
                      })}
                    </Box>
                  )}
                >
                  {users.map((user) => (
                    <MenuItem key={user._id} value={user._id}>
                      {user.firstName} {user.lastName} ({user.email})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {/* Date Range Filter */}
          {showDateFilter && (
            <>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="Date From"
                  type="date"
                  value={filters.dateFrom || ''}
                  onChange={handleDateFromChange}
                  InputLabelProps={{
                    shrink: true
                  }}
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="Date To"
                  type="date"
                  value={filters.dateTo || ''}
                  onChange={handleDateToChange}
                  InputLabelProps={{
                    shrink: true
                  }}
                  size="small"
                />
              </Grid>
            </>
          )}
        </Grid>
      </Collapse>
    </Paper>
  );
};

export default FilterToolbar;

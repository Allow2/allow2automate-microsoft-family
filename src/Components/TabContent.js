// Copyright [2025] [Allow2 Pty Ltd]
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict';

import React, { Component } from 'react';
import {
    Card,
    CardContent,
    Typography,
    Button,
    Grid,
    List,
    ListItem,
    ListItemText,
    ListItemAvatar,
    Avatar,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    IconButton,
    CircularProgress,
    Chip,
    Box,
    Alert
} from '@material-ui/core';
import {
    Refresh as RefreshIcon,
    Link as LinkIcon,
    LinkOff as UnlinkIcon,
    Schedule as ScheduleIcon
} from '@material-ui/icons';

class TabContent extends Component {
    constructor(props) {
        super(props);

        this.state = {
            loading: false,
            authenticated: false,
            children: [],
            allow2Children: [],
            childLinks: {},
            quotaState: {},
            screenTime: {},
            lastSync: null,
            tokenExpiry: null,
            error: null,
            success: null,
            selectedChild: {},
            selectedAllow2Child: {}
        };
    }

    componentDidMount() {
        this.loadStatus();

        // Get Allow2 children
        if (this.props.allow2Children) {
            this.setState({ allow2Children: this.props.allow2Children });
        }
    }

    loadStatus = async () => {
        try {
            const [error, result] = await window.ipcRenderer.invoke('msFamily.getStatus');

            if (error) {
                this.setState({ error: error.message });
                return;
            }

            this.setState({
                authenticated: result.authenticated,
                children: Object.values(result.children || {}),
                childLinks: result.childLinks || {},
                quotaState: result.quotaState || {},
                lastSync: result.lastSync,
                tokenExpiry: result.tokenExpiry
            });

        } catch (error) {
            this.setState({ error: error.message });
        }
    };

    handleAuthenticate = async () => {
        this.setState({ loading: true, error: null, success: null });

        try {
            const [error, result] = await window.ipcRenderer.invoke('msFamily.authenticate');

            if (error) {
                this.setState({ error: error.message, loading: false });
                return;
            }

            this.setState({
                authenticated: true,
                success: 'Successfully authenticated with Microsoft!',
                loading: false,
                tokenExpiry: result.expiresAt
            });

            // Load children after authentication
            setTimeout(() => this.handleGetChildren(), 1000);

        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    };

    handleGetChildren = async () => {
        this.setState({ loading: true, error: null });

        try {
            const [error, result] = await window.ipcRenderer.invoke('msFamily.getChildren');

            if (error) {
                this.setState({ error: error.message, loading: false });
                return;
            }

            this.setState({
                children: result.children || [],
                loading: false
            });

        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    };

    handleLinkChild = async (msChildId) => {
        const allow2ChildId = this.state.selectedAllow2Child[msChildId];

        if (!allow2ChildId) {
            this.setState({ error: 'Please select an Allow2 child to link' });
            return;
        }

        this.setState({ loading: true, error: null });

        try {
            const [error, result] = await window.ipcRenderer.invoke('msFamily.linkChild', {
                msChildId,
                allow2ChildId
            });

            if (error) {
                this.setState({ error: error.message, loading: false });
                return;
            }

            // Update local state
            const childLinks = { ...this.state.childLinks };
            childLinks[msChildId] = allow2ChildId;

            this.setState({
                childLinks,
                success: 'Child linked successfully!',
                loading: false
            });

        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    };

    handleUnlinkChild = async (msChildId) => {
        this.setState({ loading: true, error: null });

        try {
            const [error, result] = await window.ipcRenderer.invoke('msFamily.unlinkChild', {
                msChildId
            });

            if (error) {
                this.setState({ error: error.message, loading: false });
                return;
            }

            // Update local state
            const childLinks = { ...this.state.childLinks };
            delete childLinks[msChildId];

            this.setState({
                childLinks,
                success: 'Child unlinked successfully!',
                loading: false
            });

        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    };

    handleSyncNow = async () => {
        this.setState({ loading: true, error: null });

        try {
            const [error, result] = await window.ipcRenderer.invoke('msFamily.syncNow');

            if (error) {
                this.setState({ error: error.message, loading: false });
                return;
            }

            this.setState({
                lastSync: result.syncTime,
                success: 'Quotas synced successfully!',
                loading: false
            });

        } catch (error) {
            this.setState({ error: error.message, loading: false });
        }
    };

    formatTime = (timestamp) => {
        if (!timestamp) return 'Never';
        return new Date(timestamp).toLocaleString();
    };

    getLinkedAllow2ChildName = (msChildId) => {
        const allow2ChildId = this.state.childLinks[msChildId];
        if (!allow2ChildId) return null;

        const child = this.state.allow2Children.find(c => c.id === allow2ChildId);
        return child ? child.name : 'Unknown';
    };

    render() {
        const {
            loading,
            authenticated,
            children,
            allow2Children,
            childLinks,
            lastSync,
            tokenExpiry,
            error,
            success,
            selectedAllow2Child
        } = this.state;

        return (
            <Box p={2}>
                <Grid container spacing={3}>
                    {/* Header */}
                    <Grid item xs={12}>
                        <Box display="flex" alignItems="center" justifyContent="space-between">
                            <Typography variant="h4">
                                Microsoft Family Safety
                            </Typography>
                            <IconButton onClick={this.loadStatus} disabled={loading}>
                                <RefreshIcon />
                            </IconButton>
                        </Box>
                    </Grid>

                    {/* Error/Success Messages */}
                    {error && (
                        <Grid item xs={12}>
                            <Alert severity="error" onClose={() => this.setState({ error: null })}>
                                {error}
                            </Alert>
                        </Grid>
                    )}

                    {success && (
                        <Grid item xs={12}>
                            <Alert severity="success" onClose={() => this.setState({ success: null })}>
                                {success}
                            </Alert>
                        </Grid>
                    )}

                    {/* Authentication Status */}
                    <Grid item xs={12}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    Authentication Status
                                </Typography>

                                {!authenticated ? (
                                    <Box>
                                        <Typography variant="body2" color="textSecondary" paragraph>
                                            Connect your Microsoft Family Safety account to manage screen time limits.
                                        </Typography>
                                        <Button
                                            variant="contained"
                                            color="primary"
                                            onClick={this.handleAuthenticate}
                                            disabled={loading}
                                            startIcon={loading ? <CircularProgress size={20} /> : <LinkIcon />}
                                        >
                                            Sign in with Microsoft
                                        </Button>
                                    </Box>
                                ) : (
                                    <Box>
                                        <Chip
                                            label="Connected"
                                            color="primary"
                                            icon={<LinkIcon />}
                                        />
                                        <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
                                            Token expires: {this.formatTime(tokenExpiry)}
                                        </Typography>
                                        <Typography variant="body2" color="textSecondary">
                                            Last sync: {this.formatTime(lastSync)}
                                        </Typography>
                                        <Box mt={2}>
                                            <Button
                                                variant="outlined"
                                                onClick={this.handleGetChildren}
                                                disabled={loading}
                                                style={{ marginRight: 8 }}
                                            >
                                                Refresh Children
                                            </Button>
                                            <Button
                                                variant="outlined"
                                                color="primary"
                                                onClick={this.handleSyncNow}
                                                disabled={loading}
                                                startIcon={<ScheduleIcon />}
                                            >
                                                Sync Quotas Now
                                            </Button>
                                        </Box>
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Children Management */}
                    {authenticated && children.length > 0 && (
                        <Grid item xs={12}>
                            <Card>
                                <CardContent>
                                    <Typography variant="h6" gutterBottom>
                                        Child Account Management
                                    </Typography>

                                    <Typography variant="body2" color="textSecondary" paragraph>
                                        Link Microsoft Family children with Allow2 accounts to enforce quotas.
                                    </Typography>

                                    <List>
                                        {children.map(child => {
                                            const isLinked = !!childLinks[child.id];
                                            const linkedName = this.getLinkedAllow2ChildName(child.id);

                                            return (
                                                <ListItem key={child.id} divider>
                                                    <ListItemAvatar>
                                                        <Avatar src={child.avatar}>
                                                            {child.name.charAt(0)}
                                                        </Avatar>
                                                    </ListItemAvatar>

                                                    <ListItemText
                                                        primary={child.name}
                                                        secondary={
                                                            isLinked
                                                                ? `Linked to: ${linkedName}`
                                                                : 'Not linked'
                                                        }
                                                    />

                                                    {!isLinked ? (
                                                        <Box display="flex" alignItems="center" gap={1}>
                                                            <FormControl style={{ minWidth: 200 }}>
                                                                <InputLabel>Allow2 Child</InputLabel>
                                                                <Select
                                                                    value={selectedAllow2Child[child.id] || ''}
                                                                    onChange={(e) => {
                                                                        const selected = { ...selectedAllow2Child };
                                                                        selected[child.id] = e.target.value;
                                                                        this.setState({ selectedAllow2Child: selected });
                                                                    }}
                                                                >
                                                                    {allow2Children.map(a2child => (
                                                                        <MenuItem key={a2child.id} value={a2child.id}>
                                                                            {a2child.name}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </FormControl>
                                                            <Button
                                                                variant="outlined"
                                                                color="primary"
                                                                onClick={() => this.handleLinkChild(child.id)}
                                                                disabled={loading || !selectedAllow2Child[child.id]}
                                                                startIcon={<LinkIcon />}
                                                            >
                                                                Link
                                                            </Button>
                                                        </Box>
                                                    ) : (
                                                        <Button
                                                            variant="outlined"
                                                            color="secondary"
                                                            onClick={() => this.handleUnlinkChild(child.id)}
                                                            disabled={loading}
                                                            startIcon={<UnlinkIcon />}
                                                        >
                                                            Unlink
                                                        </Button>
                                                    )}
                                                </ListItem>
                                            );
                                        })}
                                    </List>
                                </CardContent>
                            </Card>
                        </Grid>
                    )}

                    {/* Help Info */}
                    <Grid item xs={12}>
                        <Alert severity="info">
                            <Typography variant="body2">
                                <strong>How it works:</strong>
                            </Typography>
                            <Typography variant="body2" component="ul">
                                <li>Sign in with your Microsoft account</li>
                                <li>Link Microsoft Family children with Allow2 accounts</li>
                                <li>Quotas from Allow2 automatically enforce screen time limits</li>
                                <li>When quota is low (&lt;30 min), syncs every 10 minutes</li>
                                <li>When quota increases, syncs immediately</li>
                            </Typography>
                        </Alert>
                    </Grid>
                </Grid>
            </Box>
        );
    }
}

export default TabContent;

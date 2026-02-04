// Parse and visualize Google Ads data with multi-account support
let accountsData = {
    top10: null,
    bur: null
};

let filteredData = {
    top10: null,
    bur: null
};

let charts = {
    cost: null,
    conversions: null,
    costPerConv: null,
    convRate: null
};

let currentView = 'comparison'; // 'single' or 'comparison'
let currentAccount = 'top10';
let currentTimeFilter = 'all';
let customStartDate = null;
let customEndDate = null;

// Account colors for charts - more contrasting colors
const accountColors = {
    top10: {
        primary: '#3b82f6',  // Bright blue
        background: 'rgba(59, 130, 246, 0.1)',
        secondary: '#2563eb',  // Darker blue for hover
        label: 'Top 10'
    },
    bur: {
        primary: '#ec4899',  // Pink/Magenta
        background: 'rgba(236, 72, 153, 0.1)',
        secondary: '#db2777',  // Darker pink for hover
        label: 'BUR'
    }
};

// Function to format currency
function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(value);
}

// Function to parse CSV data
function parseCSVData(csvText, accountName) {
    const lines = csvText.trim().split('\n');
    const dateRangeMatch = lines[1].match(/"(.+)"/);
    const dateRange = dateRangeMatch ? dateRangeMatch[1] : 'Date Range Not Available';

    // Skip header rows and parse data
    const dataRows = lines.slice(3);
    const data = [];

    dataRows.forEach(row => {
        const cols = row.split(',');
        if (cols.length >= 5 && cols[0] !== 'Month') {
            data.push({
                month: cols[0],
                currency: cols[1],
                cost: parseFloat(cols[2]) || 0,
                conversions: parseFloat(cols[3]) || 0,
                costPerConv: parseFloat(cols[4]) || 0,
                convRate: parseFloat(cols[5]?.replace('%', '')) || 0
            });
        }
    });

    return {
        data: data.reverse(), // Reverse to show chronologically
        dateRange: dateRange,
        accountName: accountName
    };
}

// Function to filter data by time period
function filterDataByTimePeriod(data) {
    if (!data || !data.data) return null;

    let filteredRows = [...data.data];
    const now = new Date();

    if (currentTimeFilter === 'all') {
        // No filtering needed
    } else if (currentTimeFilter === 'custom' && customStartDate && customEndDate) {
        filteredRows = filteredRows.filter(row => {
            const rowDate = new Date(row.month + ' 1, 2000'); // Parse month string
            const startDate = new Date(customStartDate);
            const endDate = new Date(customEndDate);
            return rowDate >= startDate && rowDate <= endDate;
        });
    } else if (currentTimeFilter !== 'custom') {
        const months = parseInt(currentTimeFilter);
        filteredRows = filteredRows.slice(-months);
    }

    return {
        ...data,
        data: filteredRows
    };
}

// Function to calculate summary statistics
function calculateStats(data) {
    const totalCost = data.reduce((sum, row) => sum + row.cost, 0);
    const totalConversions = data.reduce((sum, row) => sum + row.conversions, 0);
    const avgCostPerConv = totalConversions > 0 ? totalCost / totalConversions : 0;
    const avgConvRate = data.length > 0 ? data.reduce((sum, row) => sum + row.convRate, 0) / data.length : 0;

    return {
        totalCost,
        totalConversions,
        avgCostPerConv,
        avgConvRate
    };
}

// Function to display summary statistics
function displayStats() {
    const statsGrid = document.getElementById('statsGrid');

    if (currentView === 'single') {
        const account = filteredData[currentAccount] || accountsData[currentAccount];
        if (!account) return;

        const stats = calculateStats(account.data);
        statsGrid.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Total Spend</div>
                <div class="stat-value">${formatCurrency(stats.totalCost)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Conversions</div>
                <div class="stat-value">${stats.totalConversions.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg Cost/Conversion</div>
                <div class="stat-value">${formatCurrency(stats.avgCostPerConv)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg Conversion Rate</div>
                <div class="stat-value">${stats.avgConvRate.toFixed(2)}%</div>
            </div>
        `;
    } else {
        // Comparison view
        const top10Data = filteredData.top10 || accountsData.top10;
        const burData = filteredData.bur || accountsData.bur;
        const top10Stats = top10Data ? calculateStats(top10Data.data) : null;
        const burStats = burData ? calculateStats(burData.data) : null;

        if (!top10Stats || !burStats) return;

        statsGrid.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Total Spend Comparison</div>
                <div class="stat-value" style="font-size: 1.2rem;">
                    <span class="account-badge badge-top10">TOP10</span> ${formatCurrency(top10Stats.totalCost)}<br>
                    <span class="account-badge badge-bur">BUR</span> ${formatCurrency(burStats.totalCost)}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Conversions</div>
                <div class="stat-value" style="font-size: 1.2rem;">
                    <span class="account-badge badge-top10">TOP10</span> ${top10Stats.totalConversions.toLocaleString()}<br>
                    <span class="account-badge badge-bur">BUR</span> ${burStats.totalConversions.toLocaleString()}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg Cost/Conversion</div>
                <div class="stat-value" style="font-size: 1.2rem;">
                    <span class="account-badge badge-top10">TOP10</span> ${formatCurrency(top10Stats.avgCostPerConv)}<br>
                    <span class="account-badge badge-bur">BUR</span> ${formatCurrency(burStats.avgCostPerConv)}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg Conversion Rate</div>
                <div class="stat-value" style="font-size: 1.2rem;">
                    <span class="account-badge badge-top10">TOP10</span> ${top10Stats.avgConvRate.toFixed(2)}%<br>
                    <span class="account-badge badge-bur">BUR</span> ${burStats.avgConvRate.toFixed(2)}%
                </div>
            </div>
        `;
    }
}

// Function to destroy existing charts
function destroyCharts() {
    Object.keys(charts).forEach(key => {
        if (charts[key]) {
            charts[key].destroy();
            charts[key] = null;
        }
    });
}

// Function to create or update charts
function updateCharts() {
    destroyCharts();

    if (currentView === 'single') {
        const account = filteredData[currentAccount] || accountsData[currentAccount];
        if (!account) return;

        createSingleAccountCharts(account.data, currentAccount);
    } else {
        createComparisonCharts();
    }
}

// Function to create single account charts
function createSingleAccountCharts(data, accountKey) {
    const colors = accountColors[accountKey];
    const labels = data.map(row => row.month);

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: {
                display: false
            }
        },
        scales: {
            y: {
                beginAtZero: true
            }
        }
    };

    // Cost Chart
    charts.cost = new Chart(document.getElementById('costChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data.map(row => row.cost),
                borderColor: colors.primary,
                backgroundColor: colors.background,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });

    // Conversions Chart
    charts.conversions = new Chart(document.getElementById('conversionsChart'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data.map(row => row.conversions),
                backgroundColor: colors.primary,
                borderRadius: 5
            }]
        },
        options: chartOptions
    });

    // Cost Per Conversion Chart
    charts.costPerConv = new Chart(document.getElementById('cpcChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data.map(row => row.costPerConv),
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(2);
                        }
                    }
                }
            }
        }
    });

    // Conversion Rate Chart
    charts.convRate = new Chart(document.getElementById('convRateChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data.map(row => row.convRate),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1) + '%';
                        }
                    }
                }
            }
        }
    });
}

// Function to create comparison charts
function createComparisonCharts() {
    const top10Account = filteredData.top10 || accountsData.top10;
    const burAccount = filteredData.bur || accountsData.bur;

    if (!top10Account || !burAccount) return;

    // Find common months for alignment
    const top10Data = top10Account.data;
    const burData = burAccount.data;

    // Helper function to generate all months between start and end
    function generateMonthRange(startMonth, endMonth) {
        const months = [];
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];

        // Parse start and end dates
        const parseMonthYear = (monthStr) => {
            const parts = monthStr.split(' ');
            const month = monthNames.indexOf(parts[0]);
            const year = parseInt(parts[1]);
            return { month, year };
        };

        const start = parseMonthYear(startMonth);
        const end = parseMonthYear(endMonth);

        let currentYear = start.year;
        let currentMonth = start.month;

        while (currentYear < end.year || (currentYear === end.year && currentMonth <= end.month)) {
            months.push(`${monthNames[currentMonth]} ${currentYear}`);
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
        }

        return months;
    }

    // Find the earliest and latest months from both datasets
    const allDataMonths = [...top10Data.map(d => d.month), ...burData.map(d => d.month)];
    const sortedMonths = allDataMonths.sort((a, b) => {
        const dateA = new Date(a + ' 1, 2020');
        const dateB = new Date(b + ' 1, 2020');
        return dateA - dateB;
    });

    // Generate complete timeline from earliest to latest month
    const allMonths = sortedMonths.length > 0
        ? generateMonthRange(sortedMonths[0], sortedMonths[sortedMonths.length - 1])
        : [];

    // Create aligned data arrays - use null for missing data points instead of 0
    const getAlignedData = (data, field) => {
        const dataMap = new Map(data.map(row => [row.month, row[field]]));
        return allMonths.map(month => {
            const value = dataMap.get(month);
            return value !== undefined ? value : null;
        });
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: true,
        spanGaps: true, // Connect lines across null values
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: {
                    font: {
                        size: 14,
                        weight: 'bold'
                    },
                    padding: 15,
                    usePointStyle: true
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleFont: {
                    size: 14
                },
                bodyFont: {
                    size: 13
                },
                filter: function(tooltipItem) {
                    // Only show tooltip items that have data
                    return tooltipItem.raw !== null;
                }
            }
        },
        interaction: {
            mode: 'index',
            intersect: false
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)'
                }
            },
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    autoSkip: true,
                    maxTicksLimit: 12
                }
            }
        }
    };

    // Cost Chart
    charts.cost = new Chart(document.getElementById('costChart'), {
        type: 'line',
        data: {
            labels: allMonths,
            datasets: [
                {
                    label: 'Top 10',
                    data: getAlignedData(top10Data, 'cost'),
                    borderColor: accountColors.top10.primary,
                    backgroundColor: accountColors.top10.background,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: accountColors.top10.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: 'BUR',
                    data: getAlignedData(burData, 'cost'),
                    borderColor: accountColors.bur.primary,
                    backgroundColor: accountColors.bur.background,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: accountColors.bur.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            ...chartOptions,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });

    // Conversions Chart
    charts.conversions = new Chart(document.getElementById('conversionsChart'), {
        type: 'bar',
        data: {
            labels: allMonths,
            datasets: [
                {
                    label: 'Top 10',
                    data: getAlignedData(top10Data, 'conversions'),
                    backgroundColor: accountColors.top10.primary,
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                },
                {
                    label: 'BUR',
                    data: getAlignedData(burData, 'conversions'),
                    backgroundColor: accountColors.bur.primary,
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }
            ]
        },
        options: {
            ...chartOptions,
            skipNull: true
        }
    });

    // Cost Per Conversion Chart
    charts.costPerConv = new Chart(document.getElementById('cpcChart'), {
        type: 'line',
        data: {
            labels: allMonths,
            datasets: [
                {
                    label: 'Top 10',
                    data: getAlignedData(top10Data, 'costPerConv'),
                    borderColor: accountColors.top10.primary,
                    backgroundColor: accountColors.top10.background,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: accountColors.top10.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: 'BUR',
                    data: getAlignedData(burData, 'costPerConv'),
                    borderColor: accountColors.bur.primary,
                    backgroundColor: accountColors.bur.background,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: accountColors.bur.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            ...chartOptions,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(2);
                        }
                    }
                }
            }
        }
    });

    // Conversion Rate Chart
    charts.convRate = new Chart(document.getElementById('convRateChart'), {
        type: 'line',
        data: {
            labels: allMonths,
            datasets: [
                {
                    label: 'Top 10',
                    data: getAlignedData(top10Data, 'convRate'),
                    borderColor: accountColors.top10.primary,
                    backgroundColor: accountColors.top10.background,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: accountColors.top10.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: 'BUR',
                    data: getAlignedData(burData, 'convRate'),
                    borderColor: accountColors.bur.primary,
                    backgroundColor: accountColors.bur.background,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: accountColors.bur.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            ...chartOptions,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1) + '%';
                        }
                    }
                }
            }
        }
    });
}

// Function to populate table
function populateTable() {
    const tableBody = document.getElementById('tableBody');
    const tableTitle = document.getElementById('tableTitle');
    const tableHeader = document.getElementById('tableHeader');

    tableBody.innerHTML = '';

    if (currentView === 'single') {
        const account = filteredData[currentAccount] || accountsData[currentAccount];
        if (!account) return;

        tableTitle.textContent = `Monthly Performance Details - ${accountColors[currentAccount].label}`;
        tableHeader.innerHTML = `
            <tr>
                <th>Month</th>
                <th>Cost (USD)</th>
                <th>Conversions</th>
                <th>Cost/Conv</th>
                <th>Conv Rate</th>
            </tr>
        `;

        account.data.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.month}</td>
                <td>${formatCurrency(row.cost)}</td>
                <td>${row.conversions.toLocaleString()}</td>
                <td>${formatCurrency(row.costPerConv)}</td>
                <td>${row.convRate.toFixed(2)}%</td>
            `;
            tableBody.appendChild(tr);
        });
    } else {
        // Comparison table
        tableTitle.textContent = 'Monthly Performance Comparison';
        tableHeader.innerHTML = `
            <tr>
                <th>Month</th>
                <th>Account</th>
                <th>Cost (USD)</th>
                <th>Conversions</th>
                <th>Cost/Conv</th>
                <th>Conv Rate</th>
            </tr>
        `;

        const top10Account = filteredData.top10 || accountsData.top10;
        const burAccount = filteredData.bur || accountsData.bur;

        if (!top10Account || !burAccount) return;

        // Create combined and sorted data
        const combinedData = [];

        top10Account.data.forEach(row => {
            combinedData.push({
                ...row,
                account: 'Top 10',
                accountKey: 'top10'
            });
        });

        burAccount.data.forEach(row => {
            combinedData.push({
                ...row,
                account: 'BUR',
                accountKey: 'bur'
            });
        });

        // Sort by month (newest first) then by account
        combinedData.sort((a, b) => {
            const monthCompare = b.month.localeCompare(a.month);
            if (monthCompare !== 0) return monthCompare;
            return a.account.localeCompare(b.account);
        });

        combinedData.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.month}</td>
                <td><span class="account-badge badge-${row.accountKey}">${row.account}</span></td>
                <td>${formatCurrency(row.cost)}</td>
                <td>${row.conversions.toLocaleString()}</td>
                <td>${formatCurrency(row.costPerConv)}</td>
                <td>${row.convRate.toFixed(2)}%</td>
            `;
            tableBody.appendChild(tr);
        });
    }
}

// Function to update date range display
function updateDateRange() {
    const dateRangeEl = document.getElementById('dateRange');

    if (currentView === 'single') {
        const account = accountsData[currentAccount];
        if (account) {
            dateRangeEl.textContent = `${accountColors[currentAccount].label}: ${account.dateRange}`;
        }
    } else {
        const ranges = [];
        if (accountsData.top10) ranges.push(`Top 10: ${accountsData.top10.dateRange}`);
        if (accountsData.bur) ranges.push(`BUR: ${accountsData.bur.dateRange}`);
        dateRangeEl.textContent = ranges.join(' | ');
    }
}

// Function to apply time filter
function applyTimeFilter() {
    // Apply filter to both accounts
    if (accountsData.top10) {
        filteredData.top10 = filterDataByTimePeriod(accountsData.top10);
    }
    if (accountsData.bur) {
        filteredData.bur = filterDataByTimePeriod(accountsData.bur);
    }

    updateDashboard();
}

// Function to update the entire dashboard
function updateDashboard() {
    updateDateRange();
    displayStats();
    updateCharts();
    populateTable();
}

// Event listeners
document.getElementById('singleViewBtn').addEventListener('click', function() {
    if (currentView === 'single') return;

    currentView = 'single';
    document.getElementById('singleViewBtn').classList.add('active');
    document.getElementById('comparisonViewBtn').classList.remove('active');
    document.getElementById('accountSelector').style.display = 'flex';

    updateDashboard();
});

document.getElementById('comparisonViewBtn').addEventListener('click', function() {
    if (currentView === 'comparison') return;

    currentView = 'comparison';
    document.getElementById('comparisonViewBtn').classList.add('active');
    document.getElementById('singleViewBtn').classList.remove('active');
    document.getElementById('accountSelector').style.display = 'none';

    updateDashboard();
});

document.getElementById('accountSelect').addEventListener('change', function(e) {
    currentAccount = e.target.value;
    updateDashboard();
});

// Time period selector
document.getElementById('timePeriodSelect').addEventListener('change', function(e) {
    currentTimeFilter = e.target.value;

    if (currentTimeFilter === 'custom') {
        document.getElementById('customRangeGroup').style.display = 'flex';

        // Set default dates for custom range
        const now = new Date();
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

        document.getElementById('endMonth').value = now.toISOString().slice(0, 7);
        document.getElementById('startMonth').value = sixMonthsAgo.toISOString().slice(0, 7);
    } else {
        document.getElementById('customRangeGroup').style.display = 'none';
        applyTimeFilter();
    }
});

// Apply custom range button
document.getElementById('applyRangeBtn').addEventListener('click', function() {
    customStartDate = document.getElementById('startMonth').value;
    customEndDate = document.getElementById('endMonth').value;

    if (customStartDate && customEndDate) {
        applyTimeFilter();
    }
});

// Load both CSV files
Promise.all([
    fetch('topten_all_basic.csv').then(r => r.text()),
    fetch('bur_all_basic.csv').then(r => r.text())
])
.then(([top10CSV, burCSV]) => {
    accountsData.top10 = parseCSVData(top10CSV, 'top10');
    accountsData.bur = parseCSVData(burCSV, 'bur');

    // Initialize filtered data
    filteredData.top10 = accountsData.top10;
    filteredData.bur = accountsData.bur;

    updateDashboard();
})
.catch(error => {
    console.error('Error loading CSV files:', error);
    document.getElementById('dateRange').textContent = 'Error loading data';
});
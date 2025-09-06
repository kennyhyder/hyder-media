let projectionChart = null;

function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

function calculateROI() {
    console.log('Calculate ROI clicked'); // Debug log
    
    // Get input values
    const adSpend = parseFloat(document.getElementById('adSpend').value) || 0;
    const cpc = parseFloat(document.getElementById('cpc').value) || 0;
    const ctr = parseFloat(document.getElementById('ctr').value) || 0;
    const conversionRate = parseFloat(document.getElementById('conversionRate').value) || 0;
    const aov = parseFloat(document.getElementById('aov').value) || 0;
    const ltv = parseFloat(document.getElementById('ltv').value) || 0;
    const margin = parseFloat(document.getElementById('margin').value) || 0;
    const projectionPeriod = parseInt(document.getElementById('projectionPeriod').value) || 1;

    console.log('Input values:', { adSpend, cpc, ctr, conversionRate, aov, ltv, margin, projectionPeriod });

    // Calculate metrics
    const clicks = cpc > 0 ? adSpend / cpc : 0;
    const conversions = clicks * (conversionRate / 100);
    const cpa = conversions > 0 ? adSpend / conversions : 0;
    
    // Revenue calculations
    const immediateRevenue = conversions * aov;
    const lifetimeRevenue = conversions * ltv;
    
    // Use lifetime value for ROAS calculation if available, otherwise use AOV
    const revenueForROAS = ltv > aov ? lifetimeRevenue : immediateRevenue;
    const roas = adSpend > 0 ? (revenueForROAS / adSpend) * 100 : 0;
    const roasRatio = adSpend > 0 ? revenueForROAS / adSpend : 0;
    
    // Profit calculations
    const grossProfit = revenueForROAS * (margin / 100);
    const netProfit = grossProfit - adSpend;
    const roi = adSpend > 0 ? ((netProfit / adSpend) * 100) : 0;

    console.log('Calculated values:', { clicks, conversions, cpa, revenueForROAS, roas, netProfit, roi });

    // Update display
    document.getElementById('roasValue').textContent = roas.toFixed(0) + '%';
    document.getElementById('roasRatio').textContent = '$' + roasRatio.toFixed(2);
    document.getElementById('cpaValue').textContent = formatCurrency(cpa);
    document.getElementById('conversionsValue').textContent = formatNumber(Math.round(conversions));
    document.getElementById('revenueValue').textContent = formatCurrency(revenueForROAS);
    document.getElementById('profitValue').textContent = formatCurrency(netProfit);
    document.getElementById('roiValue').textContent = roi.toFixed(0) + '%';

    // Update metric colors based on values
    const profitElement = document.getElementById('profitValue');
    profitElement.className = 'metric__value ' + (netProfit > 0 ? 'metric--positive' : netProfit < 0 ? 'metric--negative' : '');
    
    const roiElement = document.getElementById('roiValue');
    roiElement.className = 'metric__value ' + (roi > 0 ? 'metric--positive' : roi < 0 ? 'metric--negative' : '');

    // Generate projections
    generateProjections(adSpend, conversions, revenueForROAS, netProfit, roi, projectionPeriod);
    
    // Hide alert
    const alert = document.getElementById('calculateAlert');
    if (alert) {
        alert.style.display = 'none';
    }
}

function generateProjections(monthlyAdSpend, monthlyConversions, monthlyRevenue, monthlyProfit, monthlyROI, periods) {
    const months = [];
    const adSpendData = [];
    const revenueData = [];
    const profitData = [];
    
    // Generate monthly data
    for (let i = 1; i <= periods; i++) {
        months.push('Month ' + i);
        adSpendData.push(monthlyAdSpend * i);
        revenueData.push(monthlyRevenue * i);
        profitData.push(monthlyProfit * i);
    }

    // Update chart
    updateChart(months, adSpendData, revenueData, profitData);
    
    // Update table
    updateProjectionsTable(months, adSpendData, revenueData, profitData, monthlyROI);
}

function updateChart(labels, adSpend, revenue, profit) {
    const ctx = document.getElementById('projectionChart').getContext('2d');
    
    // Get current theme
    const isDarkMode = document.documentElement.classList.contains('dark-mode');
    const textColor = isDarkMode ? '#ffffff' : '#354231';
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    
    if (projectionChart) {
        projectionChart.destroy();
    }

    projectionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Cumulative Revenue',
                    data: revenue,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Cumulative Ad Spend',
                    data: adSpend,
                    borderColor: isDarkMode ? '#d14d00' : '#795232',
                    backgroundColor: isDarkMode ? 'rgba(209, 77, 0, 0.1)' : 'rgba(121, 82, 50, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Cumulative Profit',
                    data: profit,
                    borderColor: isDarkMode ? '#e1d42b' : '#2563eb',
                    backgroundColor: isDarkMode ? 'rgba(225, 212, 43, 0.1)' : 'rgba(37, 99, 235, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12,
                            family: 'Roboto Mono, monospace'
                        },
                        color: textColor
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        },
                        color: textColor,
                        font: {
                            family: 'Roboto Mono, monospace'
                        }
                    },
                    grid: {
                        color: gridColor
                    }
                },
                x: {
                    ticks: {
                        color: textColor,
                        font: {
                            family: 'Roboto Mono, monospace'
                        }
                    },
                    grid: {
                        color: gridColor
                    }
                }
            }
        }
    });
}

function updateProjectionsTable(months, adSpend, revenue, profit, roi) {
    const table = document.getElementById('projectionsTable');
    const tbody = document.getElementById('projectionsBody');
    
    tbody.innerHTML = '';
    
    months.forEach((month, index) => {
        const row = tbody.insertRow();
        row.insertCell(0).textContent = month;
        row.insertCell(1).textContent = formatCurrency(adSpend[index]);
        row.insertCell(2).textContent = formatCurrency(revenue[index]);
        row.insertCell(3).textContent = formatCurrency(profit[index]);
        row.insertCell(4).textContent = roi.toFixed(0) + '%';
    });
    
    table.style.display = 'table';
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Calculator JS loaded');
    
    // Theme toggle handling for chart updates
    const toggleSwitch = document.getElementById('toggleSwitch');
    if (toggleSwitch) {
        toggleSwitch.addEventListener('change', function() {
            // Wait a moment for theme to apply
            setTimeout(() => {
                // Rerun calculation to update chart colors if data exists
                const adSpend = document.getElementById('adSpend').value;
                if (adSpend && projectionChart) {
                    calculateROI();
                }
            }, 100);
        });
    }
});
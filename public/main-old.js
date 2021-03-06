
jobId = undefined

intervalId = ''

scenariomgr = undefined;

// The scenario configuration :
// - sets which tables must be used by the application (can be a subset of really existing tables)
// - allows to define an id
// - allows to set some table as editable

scenariocfg = {        
        'Units' : { id:"Units", title:"Units", allowEdition:true},        
        'Loads' : {  id:"Periods", title:"Load", allowEdition:true},
        'UnitMaintenances' : {id:null, title:"Maintenances", allowEdition:true, maxSize:10*24*7},
        'Periods' : { id:"Id", title:"Periods"},

        'production' : { title:"Production"},
        'started' : { title:"Started"},
        'used' : { title:"Used"},
        'kpis' : { id:'kpi', title:"KPIs"},

        "$scenario" : { cb : showInputsAndOutputs }
};

assignments_data = undefined;
assignments_qty = undefined;

function load() {               
        disableSolve();

        document.getElementById("SOLVE").onclick = solve;


        scenariomgr = new ScenarioManager(scenariocfg);        
        scenariomgr.loadScenarios();
        scenariomgr.showAsSelector(`scenario_div`, onChangeScenario);

        cleanSolve();
        initOptim();
};

function onChangeScenario() {
        console.log("Selected scenario " + scenariomgr.getSelectedScenario().getName());
        let scenario = scenariomgr.getSelectedScenario();
        
        showInputsAndOutputs(scenario);       
}


function initOptim() {
        console.log("Init Optim.");
        axios({
                method:'get',
                url:'/api/optim/config',
                responseType:'text'
              })
        .then(function (response) {
                obj = response.data;
                if ('deploymentDescription' in obj) {
                        solveUrl = obj.deploymentDescription.links[1].uri
                        console.log("Solve URL :" + solveUrl);
                }                      
                enableSolve();
        })
        .catch(showHttpError);     
}




function showInputsAndOutputs(scenario) {
        if (scenario != scenariomgr.getSelectedScenario())
                return;
        if (scenario == undefined)
                return;
        showAsGoogleTables(scenario, 'inputs_div', 'input',
                ['Units', 'Loads', 'UnitMaintenances'],
                 scenariocfg)
        
        showSolution(scenario);

        showKpis(scenario);
        
}

function disableSolve() {
        document.getElementById('SOLVE').disabled = true;
}

function enableSolve() {
        document.getElementById('SOLVE').disabled = false;
        document.getElementById('SOLVE').value = 'SOLVE';
}

function solve() {
        var data = new FormData();

        let scenario = scenariomgr.getSelectedScenario();
        let tableIds = scenario.getInputTables()
        for (t in tableIds)  {
                let tableId = tableIds[t];
                data.append(tableId+".csv", scenario.getTableAsCSV(tableId));
        }


        document.getElementById('SOLVE').disabled = true;
        document.getElementById('SOLVE').value = 'STARTING';
        //document.getElementById('gantt_div').style.display="none";
        
        axios({
                method: 'post',
                url: './api/optim/solve',
                data: data
        }).then(function(response) {
                jobId = response.data.jobId                        
                console.log("Job ID: "+ jobId);
                intervalId = setInterval(checkStatus, 1000)
        }).catch(showHttpError);
}

function formatDate(d) {
        return d.getFullYear()  + "/" + 
        ("00" + (d.getMonth() + 1)).slice(-2) + "/" +
    ("00" + d.getDate()).slice(-2) + 
    " " + 
    ("00" + d.getHours()).slice(-2) + ":" + 
    ("00" + d.getMinutes()).slice(-2) + ":" + 
    ("00" + d.getSeconds()).slice(-2);
}

function checkStatus() {
        let scenario = scenariomgr.getSelectedScenario();
        axios.get("/api/optim/status?jobId="+jobId)
        .then(function(response) {
                executionStatus = response.data.solveState.executionStatus
                console.log("JobId: "+jobId +" Status: "+executionStatus)
                if (executionStatus != "UNKNOWN")
                        document.getElementById('SOLVE').value = executionStatus;
                                
                if (executionStatus == "PROCESSED" ||
                        executionStatus == "INTERRUPTED" ) {
                        clearInterval(intervalId);
                        
                        let nout = response.data.outputAttachments.length;
                        for (var i = 0; i < nout; i++) {
                                let oa = response.data.outputAttachments[i];
                                if ('csv' in oa)
                                        scenario.addTableFromCSV(oa.name, oa.csv, 'output', scenariocfg[oa.name]);     
                                else
                                        scenario.addTableFromRows(oa.name, oa.table.rows, 'output', scenariocfg[oa.name]); 
                        }

                        //document.getElementById('gantt_div').style.display="block";
                        showSolution(scenario);
                        showKpis(scenario);
                        enableSolve();

                }   
        })
        //.catch(showHttpError);    
}

function cleanSolve() {
        
}


function showSolution(scenario) {
        showAsGoogleTables(scenario, 'outputs_div', 'output', 
                ['production', 'started', 'used', 'kpis'], scenariocfg)        

        colors = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395", "#994499", "#22aa99", "#aaaa11", "#6633cc", "#e67300", "#8b0707", "#651067", "#329262", "#5574a6", "#3b3eac"];
  
        production = scenario.tables['production'].rows;
        values = {}

        periods = []
        for (o in production) {
                p = production[o].Periods;
                x = periods.indexOf(p);
                if (x == -1) {
                        periods.push(p);
                        x = periods.indexOf(p);
                }
                y = parseFloat(production[o].value);
                unit = production[o].Units;                
                if (!(unit in values))
                        values[unit] = [];
                values[unit].push({x:x, y:y});
        }
        data = []
        units = []  

        for (u in values) {
                units.push(u);
                unitsidx = units.indexOf(u);
                d = {
                        values:values[u],
                        key:u,
                        color: colors[unitsidx]
                };
                data.push(d)
        }

        nvd3chart('chart', data)

        assignments = {};
        assignments_data = [];
        assignments_qty = [];        
        now = new Date('01/14/2019').getTime()

        assignments['ALL'] = {
                "id" : "ALL",
                "name" : "ALL",
                "activities" : [ ],
                "parent" : ""

        }
        for (u in units) {
                unit = units[u];
                if (assignments[unit] == undefined) {      
                        unit_type = unit.split('_')[0]; 
                        if (assignments[unit_type] == undefined) {  
                                assignments[unit_type] = {
                                        "id" : unit_type,
                                        "name" : unit_type,
                                        "activities" : [ ],
                                        "parent" : "ALL"
                
                                }   
                        }               
                        assignments[unit] = {
                                "id" : unit,
                                "name" : unit,
                                "activities" : [ ],
                                "parent" : unit_type
        
                        }
                }
        }
        for (o in production) {
                p = production[o].Periods;
                x = periods.indexOf(p);
                y = parseFloat(production[o].value);
                unit = production[o].Units;                
                if (y > 0) {
                        if (assignments_qty[unit] == undefined)
                                assignments_qty[unit] = []                        
                        taskid = unit + '-' + p;
                        assignments_qty[unit][taskid] = 1;
                        unit_type = unit.split('_')[0]; 
                        activity = { 
                                "id": taskid,
                                "name": taskid,
                                "start": (now + 60*60*1000*x),
                                "end": (now + 60*60*1000*(x+1)),
                                "unit-type": unit_type
                        };                        
                        assignments[unit].activities.push(activity);
                }
        }
        for (o in assignments)
                assignments_data.push(assignments[o]);

        showGantt('gantt_div', assignments_data, assignments_qty, config = {color:"unit-type", filters:["unit-type"]})        
}

function showKpis(scenario) {
        if (scenario != scenariomgr.getSelectedScenario())
                return;                

        showKPIsAsGoogleTable(scenariomgr, 'kpis_div');
}
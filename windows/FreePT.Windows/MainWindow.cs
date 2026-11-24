using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;
using System.Text.Json;
namespace FreePT.Windows;
internal sealed class MainWindow:Form {
    private readonly WebView2 web=new(){Dock=DockStyle.Fill};
    private readonly Label status=new(){AutoSize=false,Dock=DockStyle.Top,Height=60,Text="Bridge non configurato",
        ForeColor=Color.FromArgb(26,74,88),Font=new Font("Segoe UI",11,FontStyle.Bold)};
    private readonly ListBox roots=new(){Dock=DockStyle.Fill,IntegralHeight=false};
    private readonly TextBox email=new(){PlaceholderText="Email FreePT",Width=260};
    private readonly TextBox password=new(){PlaceholderText="Password FreePT",UseSystemPasswordChar=true,Width=260};
    private readonly Button enroll=new(){Text="Attiva Bridge Windows",Width=250,Height=45};
    private readonly Button start=new(){Text="Avvia Bridge",Width=160,Height=43};
    private readonly Button stop=new(){Text="Ferma Bridge",Width=160,Height=43};
    private readonly CheckBox startup=new(){Text="Avvia FreePT all'accesso a Windows",AutoSize=true};
    private readonly NotifyIcon tray=new(){Visible=true,Text="FreePT Windows",Icon=SystemIcons.Application};
    private BridgeAgent? agent;
    private bool quitting=false;
    private readonly TabControl tabs=new(){Dock=DockStyle.Fill};
    private BridgeConfig? config;
    internal MainWindow(){
        Text="FreePT Windows TEST";MinimumSize=new Size(700,540);Size=new Size(1080,730);
        BackColor=Color.FromArgb(239,247,248);Font=new Font("Segoe UI",10);
        var chat=new TabPage("Chat"){BackColor=Color.White};chat.Controls.Add(web);
        var bridge=new TabPage("Bridge e file"){BackColor=BackColor};
        tabs.TabPages.Add(chat);tabs.TabPages.Add(bridge);Controls.Add(tabs);
        var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(22),
            ColumnCount=1,RowCount=6,AutoScroll=true};
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,72));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,115));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,60));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,115));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,48));
        bridge.Controls.Add(layout);
        var title=new Label{Dock=DockStyle.Fill,Text="Bridge Windows  •  File condivisi",
            Font=new Font("Segoe UI",18,FontStyle.Bold),ForeColor=Color.FromArgb(18,65,83)};
        layout.Controls.Add(title,0,0);
        var top=new FlowLayoutPanel{Dock=DockStyle.Fill,AutoSize=false,WrapContents=true};
        var add=Button("Aggiungi cartella o disco");
        var remove=Button("Rimuovi selezione");
        top.Controls.Add(add);top.Controls.Add(remove);
        top.Controls.Add(new Label{Text="Condividi solo cartelle che autorizzi. Puoi includere unità USB.",
            AutoSize=true,Padding=new Padding(6,12,0,0)});
        layout.Controls.Add(top,0,1);
        layout.Controls.Add(roots,0,2);
        var stateRow=new FlowLayoutPanel{Dock=DockStyle.Fill};stateRow.Controls.Add(start);stateRow.Controls.Add(stop);
        layout.Controls.Add(stateRow,0,3);
        var credentials=new FlowLayoutPanel{Dock=DockStyle.Fill,WrapContents=true};
        credentials.Controls.Add(email);credentials.Controls.Add(password);credentials.Controls.Add(enroll);
        layout.Controls.Add(credentials,0,4);
        layout.Controls.Add(startup,0,5);
        var bottom=new Panel{Dock=DockStyle.Bottom,Height=70,Padding=new Padding(16,10,16,8)};
        bottom.Controls.Add(status);Controls.Add(bottom);bottom.BringToFront();
        add.Click+=(_,_)=>{
            using var picker=new FolderBrowserDialog{Description="Seleziona la cartella o il disco da condividere",
                ShowNewFolderButton=false};
            if(picker.ShowDialog(this)==DialogResult.OK&&!roots.Items.Contains(picker.SelectedPath))
                roots.Items.Add(picker.SelectedPath);
        };
        remove.Click+=(_,_)=>{if(roots.SelectedIndex>=0)roots.Items.RemoveAt(roots.SelectedIndex);};
        start.Click+=async(_,_)=>await StartBridge();
        stop.Click+=async(_,_)=>{if(agent!=null)await agent.Stop();status.Text="Bridge fermo";};
        enroll.Click+=async(_,_)=>await Enroll();
        startup.CheckedChanged+=(_,_)=>SetStartup(startup.Checked);
        tray.DoubleClick+=(_,_)=>ShowWindow();
        tray.ContextMenuStrip=new ContextMenuStrip();
        tray.ContextMenuStrip.Items.Add("Apri FreePT",null,(_,_)=>ShowWindow());
        tray.ContextMenuStrip.Items.Add("Esci completamente",null,(_,_)=>Quit());
        config=LocalState.Read();
        if(config!=null){
            foreach(var root in config.Roots)roots.Items.Add(root);
            email.Enabled=password.Enabled=enroll.Enabled=false;
            status.Text="PC associato. Avvio del Bridge…";
        }
        startup.Checked=HasStartup();
        Shown+=async(_,_)=>{
            await StartChat();
            if(config!=null)await StartBridge();
        };
    }
    private Button Button(string title)=>new(){Text=title,AutoSize=true,MinimumSize=new Size(130,40),
        BackColor=Color.FromArgb(25,112,127),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
    private void Display(string message){
        if(IsDisposed)return;
        if(InvokeRequired)BeginInvoke(()=>Display(message));
        else status.Text=message;
    }
    private static string? Key(){
        try {
            string path=Path.Combine(AppContext.BaseDirectory,"freept-test-config.json");
            using var doc=JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.GetProperty("supabasePublishableKey").GetString();
        }catch{return null;}
    }
    private async Task StartChat(){
        try{
            var webRoot=Path.Combine(AppContext.BaseDirectory,"www");
            if(!File.Exists(Path.Combine(webRoot,"index.html")))throw new FileNotFoundException();
            await web.EnsureCoreWebView2Async();
            web.CoreWebView2.Settings.AreDevToolsEnabled=false;
            web.CoreWebView2.Settings.IsWebMessageEnabled=false;
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("app.freept.test",webRoot,
                CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.Navigate("https://app.freept.test/index.html");
        }catch{
            tabs.SelectedIndex=1;
            Display("Chat non disponibile: verifica Microsoft Edge WebView2 Runtime.");
        }
    }
    private async Task Enroll(){
        enroll.Enabled=false;
        try{
            string[] selected=roots.Items.Cast<string>().ToArray();
            _=new BridgeCatalogue(selected);
            using var owner=new EnrollmentClient(Key()??"");
            Display("Associazione al tuo account FreePT TEST…");
            config=await owner.Enroll(email.Text.Trim(),password.Text,selected);
            password.Clear();
            email.Enabled=password.Enabled=false;
            Display("PC registrato. Bridge in avvio…");
            await StartBridge();
        }catch(Exception e){Display("Associazione non riuscita: "+e.Message);}
        finally{if(config==null)enroll.Enabled=true;}
    }
    private async Task StartBridge(){
        if(config==null){Display("Configura le cartelle ed effettua l'associazione iniziale.");return;}
        try{
            if(agent!=null)await agent.DisposeAsync();
            agent=new BridgeAgent(config);
            agent.State+=Display;
            agent.Start();
        }catch{Display("Bridge non avviato: verifica le cartelle condivise.");}
    }
    private void ShowWindow(){Show();WindowState=FormWindowState.Normal;Activate();}
    protected override void OnFormClosing(FormClosingEventArgs e){
        if(!quitting){e.Cancel=true;Hide();tray.ShowBalloonTip(2000,"FreePT Windows",
            "FreePT continua dal vassoio di sistema.",ToolTipIcon.Info);return;}
        base.OnFormClosing(e);
    }
    private void Quit(){quitting=true;tray.Visible=false;agent?.DisposeAsync().AsTask().GetAwaiter().GetResult();Close();}
    protected override void OnFormClosed(FormClosedEventArgs e){tray.Dispose();base.OnFormClosed(e);}
    private static bool HasStartup(){
        using var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        return key?.GetValue("FreePT Windows")!=null;
    }
    private static void SetStartup(bool enabled){
        using var key=Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        if(enabled)key.SetValue("FreePT Windows","\""+Application.ExecutablePath+"\"");
        else key.DeleteValue("FreePT Windows",false);
    }
}

//TODO: Mostrare una stringa che dice se chiusura dell'asta presente.
$(document).ready(function () {
    let url = new URL(window.location.href);
    let id = url.searchParams.get('id');

    printInfoObj(id);
    loadBids(id);
    
    $("#logout").on("click", function() {
        $.ajax({
            type: "POST",
            url: "/logoutuser",
            data: "{}",
            processData: false,
            contentType: "application/json"
        })
        .done(function (data, success, response) {
            console.log(success);
            if(success!=="success"){
                addAlert("alert","alert-danger","Errore nella disconnesione.","");
            } else {
                window.location.href="/login";
            }
        })
        .fail(function (response) {
            console.log(response);
        });
    });

    $("#closeAuction").on("click", function() {
        $("#closeAuction").attr("disabled", true);
        const jsonData = JSON.stringify({auctionId: id});
        $.ajax({
            type: "POST",
            url: "/closeAuction",
            data: jsonData,
            processData: false,
            contentType: "application/json"
        })
        .done(function (data, success, response) {
            addAlert("alert","alert-success","Asta chiusa con successo!","");
            $("#closeAuction").addClass("btn-hidden");
            printInfoObj(id);
        })
        .fail(function (response) {
            console.log(response);
            addAlert("alert","alert-danger","Errore! Chiusura non riuscita!","");
            $("#closeAuction").attr("disabled", false);
        });
    });
    
    $("form").submit(function (event) {
        event.preventDefault(); 
        let datas = getFormData("form_ast");
        datas.auctionId = id;
        const jsonData = JSON.stringify(datas);
        
        let highestPrice = $(".offerPrice")[0];

        if (highestPrice != null && Number(highestPrice.textContent) >= datas.price) {
            addAlert("alert2","alert-danger","Specificare un prezzo più alto dell'ultima offerta.","");
        }

        $.ajax({
            type: "POST",
            url: "/addOffer",
            data: jsonData,
            processData: false,
            contentType: "application/json"
        })
        .done(function (data, success, response) {
            if(success!=="success"){
                addAlert("alert2","alert-danger","Errore nell'inserimento dell'offerta.","");
            } else {
                $("#myModal").modal('toggle');
                printInfoObj(id);
                loadBids(id);
            }
        })
        .fail(function (response) {
            addAlert("alert2","alert-danger","Offerta non inserita, il prezzo è inferiore all'attuale.","");
        });

    });

    $("#clsModal").on("click", function() {
        $("#myModal").modal('toggle');
    });
    
    $("#openModalButton").on("click", function() {
        $("#myModal").modal('toggle');
    });


});

function printInfoObj(id){
    let jsonData = JSON.stringify({ auctionId: id });

    $.ajax({
        type: "POST",
        url: "/getAuction",
        data: jsonData,
        processData: false,
        contentType: "application/json"
    })
    .done(function (data, success, response) {
        let userCookie = document.cookie.split("user=")[1];

        if (!data.closed) {

            if(data.creator == userCookie){
                $("#closeAuction").removeClass("btn-hidden");
            } else{
                $("#openModalButton").removeClass("btn-hidden");
            }
        }

        let html = '';
        html+=`
        <div class="card mb-3">
            <div class="card-body">
                <div class="row">
                    <div class="col-md-6">
                        <h3 class="card-title h3">Oggetto: ${data.objName}</h3>
                        <p class="card-title h4">Creatore: ${data.creator}</p>
                        </div>
                        <div class="col-md-6 text-end">
                            <p class="h3">Offerta corrente: ${data.highestBid ?? data.startingPrice}€</p>
                        </div>
                    </div>
                    <div class="row">
        `;
        if(!data.closed){
            html+=`         
                        <div class="col-md-12">
                            <p class="card-text">${data.objDesc}</p>
                        </div>
            `;
        } else {
            html+=`         
                        <div class="col-md-10">
                            <p class="card-text">${data.objDesc}</p>
                        </div>
                        <div class="col-md-2">
                            <p class="card-text text-danger text-right">Asta chiusa</p>
                        </div>
            `;
        }
        html+=`
        
                    </div>
                </div>
            </div>
        </div>
        `;
        $("#ogg_vinc").html(html);
    })
    .fail(function (response) {
        console.log(response);
    });

}

function loadBids(id){
    let jsonData = JSON.stringify({ auctionId: id });
    
    $.ajax({
        type: "POST",
        url: "/getBids",
        data: jsonData,
        processData: false,
        contentType: "application/json"
    })
    .done(function (data, success, response) {
        let html = '';
        let first = true;
        for(off of data){
            html+=`
            <tr class="${first ? "table-secondary " : ""}offer">
                <td>${off.userMaker}</td>
                <td>${new Date(off.bidDate).toLocaleString()}</td>
                <td class="offerPrice">${off.bidValue}</td>
            </tr>
            `;
            first = false;
        }
        $("#cont_aste").html(html);
    })
    .fail(function (response) {
        console.log(response);
    });
}
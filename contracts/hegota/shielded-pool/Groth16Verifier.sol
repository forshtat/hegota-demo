// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 775340919173815743423959164737083610061762224450778879870130076543357515211;
    uint256 constant alphay  = 18882907573337434673901750694353680125634267075618173515696435355643507376464;
    uint256 constant betax1  = 18223379518892598017635971522262396826637089400139012334063404255074035732253;
    uint256 constant betax2  = 12319261043728571579659975063262121660864977699597361461661010503260519608048;
    uint256 constant betay1  = 16197358014277409294894053020234295118379285217951260472901626922406465055231;
    uint256 constant betay2  = 19012612637867054598950364025532819356148911348702350598056265778930834723803;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 15628698794476660814292010891078520786513405721607985834793639244173651094221;
    uint256 constant deltax2 = 15162271824268788793001008064686468699920454375008981579648257285158808997481;
    uint256 constant deltay1 = 130164442392585757837250897995997168472094446720587765596716561945451986311;
    uint256 constant deltay2 = 7891520582462202019412567218611978950761848266627061626536839218603071179907;

    
    uint256 constant IC0x = 16401827577521106095354892792224279555679941717422813030748383461575699981050;
    uint256 constant IC0y = 15834733522789718719901045967714461070196875884561039227098349460533287350330;
    
    uint256 constant IC1x = 8318958353750432144431523491230645899548472342029255854562578798589459083304;
    uint256 constant IC1y = 21302613168362167964153675898638895551734056327883430725982380146958193014662;
    
    uint256 constant IC2x = 12829173974264437407429449261837394021829494158969650808227049984231896868471;
    uint256 constant IC2y = 10425291976914350823260541198515291520564730848632094985810962239126174326231;
    
    uint256 constant IC3x = 12554342551702411104353194291309664975930574529573978241754330175761160896937;
    uint256 constant IC3y = 17406326499932396933447925797287711396558802377411848495475878091911295921213;
    
    uint256 constant IC4x = 5333506112239013585899431950822750250533695571624620518474838971051155771110;
    uint256 constant IC4y = 12053138498136115584384481340480822504735027691373475369782426150685285730756;
    
    uint256 constant IC5x = 17381093569162526334758237408993018504237578680825280257678987720824791474505;
    uint256 constant IC5y = 2822999618418981184292693308232454106898703312925975818847752126879410193125;
    
    uint256 constant IC6x = 14035586950458735142581422906956884422098973879752089719105232897497532029760;
    uint256 constant IC6y = 4885837306215865579341967507874730440176820548145819717342785765099717185612;
    
    uint256 constant IC7x = 3186447179702635795227517286397451234509015274675559782983778072578165710649;
    uint256 constant IC7y = 15559855172944749052655985076910595103147759954296378483497480112724958721328;
    
    uint256 constant IC8x = 15544643546654802198538129386025241397958902900366746755076331956048347993156;
    uint256 constant IC8y = 16767802413430012386245559765500344419499151671568671629965803357767011531978;
    
    uint256 constant IC9x = 1874210512884066309276904858130211671212689663340005928299048824164113121554;
    uint256 constant IC9y = 18738949106986413397747066873780133834820072211451096290145652261075873489724;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[9] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(500000, 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(500000, 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(500000, 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
